import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { snapshots, type SnapshotRow } from "../db/schema.js";
import type { EventBus } from "../events.js";
import { Semaphore, sleep } from "../scheduler/rateLimiter.js";
import { reserveLlmCall } from "./budget.js";
import { claimPendingSummaries } from "./claim.js";
import type { LlmClient } from "./client.js";
import { buildSummaryMessages } from "./prompt.js";

export type Summarizer = { stop(): Promise<void> };

const TICK_MS = 2000;

export type SummaryDeps = {
  db: Db;
  config: Pick<Config, "LLM_DAILY_CAP" | "LLM_PACE_HOURLY" | "LLM_MAX_ATTEMPTS">;
  llm: LlmClient | null;
  logger: FastifyBaseLogger;
  events: EventBus;
  now?: () => Date;
};

export function backoffMs(attempt: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/**
 * Turns one claimed `pending` snapshot into a summary outcome. Every path
 * ends in a terminal status or a scheduled retry; the snapshot itself is
 * never touched beyond its summary columns.
 */
export async function processSummary(deps: SummaryDeps, row: SnapshotRow): Promise<SnapshotRow["summaryStatus"]> {
  const { db, config, llm, logger } = deps;
  const now = deps.now ?? (() => new Date());

  async function finish(patch: Partial<SnapshotRow>): Promise<SnapshotRow["summaryStatus"]> {
    await db.update(snapshots).set(patch).where(eq(snapshots.id, row.id));
    const status = patch.summaryStatus ?? row.summaryStatus;
    deps.events.emit({ type: "summary.updated", competitorId: row.competitorId, snapshotId: row.id, status });
    return status;
  }

  if (!llm) {
    return finish({ summaryStatus: "disabled", summaryNextAttemptAt: null });
  }

  const budget = await reserveLlmCall(db, { dailyCap: config.LLM_DAILY_CAP, paceHourly: config.LLM_PACE_HOURLY }, now());
  if (!budget.allowed && budget.reason === "paced") {
    // Not a failure: the hourly slice is used up. Queue for the next hour; the diff is already visible.
    logger.info({ snapshotId: row.id, retryAt: budget.retryAt }, "LLM hourly budget used; summary queued");
    return finish({
      summaryAttempts: row.summaryAttempts - 1, // pacing is not an attempt
      summaryError: `Hourly LLM budget used (${budget.used}/${config.LLM_DAILY_CAP} today); queued for ${budget.retryAt?.toISOString() ?? "later"}`,
      summaryNextAttemptAt: budget.retryAt,
    });
  }
  if (!budget.allowed) {
    logger.warn({ snapshotId: row.id }, "LLM daily cap reached; summary skipped");
    return finish({
      summaryStatus: "cap_reached",
      summaryError: `Daily cap of ${config.LLM_DAILY_CAP} LLM calls reached`,
      summaryNextAttemptAt: null,
    });
  }

  const result = await llm.complete(
    buildSummaryMessages({ competitorId: row.competitorId, fetchedAt: row.fetchedAt, changes: row.changes ?? [] }),
  );

  if (result.kind === "ok") {
    logger.info({ snapshotId: row.id, used: budget.used }, "summary stored");
    return finish({
      summary: result.content,
      summaryStatus: "ok",
      summarySource: "llm",
      summaryModel: result.model,
      summaryError: null,
      summaryNextAttemptAt: null,
    });
  }
  if (result.kind === "unusable") {
    logger.warn({ snapshotId: row.id, reason: result.message }, "LLM answer unusable");
    return finish({ summaryStatus: "unusable", summaryError: result.message, summaryNextAttemptAt: null });
  }
  if (!result.retryable || row.summaryAttempts >= config.LLM_MAX_ATTEMPTS) {
    logger.error(
      { snapshotId: row.id, attempts: row.summaryAttempts, retryable: result.retryable, error: result.message },
      "LLM call failed; giving up",
    );
    return finish({ summaryStatus: "failed", summaryError: result.message, summaryNextAttemptAt: null });
  }
  const delay = backoffMs(row.summaryAttempts);
  logger.warn({ snapshotId: row.id, attempt: row.summaryAttempts, backoffMs: delay, error: result.message }, "LLM call failed; will retry");
  return finish({ summaryError: result.message, summaryNextAttemptAt: new Date(now().getTime() + delay) });
}

/**
 * Background worker that drains `pending` snapshots. Decoupled from polling
 * on purpose: the poll result is already stored when this runs, so a slow or
 * broken LLM can never lose a snapshot.
 */
export function startSummarizer(deps: SummaryDeps & { config: Config }): Summarizer {
  const { db, config, llm, logger } = deps;
  const semaphore = new Semaphore(config.LLM_CONCURRENCY);
  const inFlight = new Set<Promise<void>>();
  let running = true;

  async function loop(): Promise<void> {
    while (running) {
      try {
        const rows = await claimPendingSummaries(db, config.LLM_CONCURRENCY);
        for (const row of rows) {
          const release = await semaphore.acquire();
          const task = processSummary(deps, row)
            .then(() => undefined)
            .catch((err) => logger.error({ err, snapshotId: row.id }, "summary worker failed unexpectedly"))
            .finally(() => {
              release();
              inFlight.delete(task);
            });
          inFlight.add(task);
        }
        if (rows.length === 0) await sleep(TICK_MS);
      } catch (err) {
        logger.error({ err }, "summarizer tick failed");
        await sleep(TICK_MS);
      }
    }
  }

  const loopPromise = loop();
  logger.info(
    { enabled: llm !== null, model: llm?.model ?? null, dailyCap: config.LLM_DAILY_CAP, paceHourly: config.LLM_PACE_HOURLY },
    "summarizer started",
  );

  return {
    async stop() {
      running = false;
      await loopPromise;
      await Promise.allSettled([...inFlight]);
    },
  };
}
