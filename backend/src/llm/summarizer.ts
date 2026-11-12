import { eq, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { EventBus } from "../events.js";
import { snapshots, type SnapshotRow } from "../db/schema.js";
import { Semaphore, sleep } from "../scheduler/rateLimiter.js";
import { reserveLlmCall } from "./budget.js";
import type { LlmClient } from "./client.js";
import { buildSummaryMessages } from "./prompt.js";

export type Summarizer = { stop(): Promise<void> };

const TICK_MS = 2000;
/** How long a claimed row is invisible to other workers; covers a crash mid-call. */
const LEASE_MS = 120_000;

/**
 * Background worker that turns `pending` snapshots into summaries.
 *
 * It is decoupled from polling on purpose: the poll result is already stored
 * when this runs, so a slow or broken LLM can never lose a snapshot. Rows are
 * claimed with SKIP LOCKED and a lease, retried with backoff, and every attempt
 * is charged against the daily budget before the call is made.
 */
export function startSummarizer(deps: {
  db: Db;
  config: Config;
  llm: LlmClient | null;
  logger: FastifyBaseLogger;
  events: EventBus;
}): Summarizer {
  const { db, config, llm, logger } = deps;
  const semaphore = new Semaphore(config.LLM_CONCURRENCY);
  const inFlight = new Set<Promise<void>>();
  let running = true;

  async function claim(limit: number): Promise<SnapshotRow[]> {
    const result = await db.execute<{ id: number }>(sql`
      update snapshots
      set summary_attempts = summary_attempts + 1,
          summary_next_attempt_at = now() + make_interval(secs => ${LEASE_MS / 1000})
      where id in (
        select id from snapshots
        where summary_status = 'pending' and summary_next_attempt_at <= now()
        order by summary_next_attempt_at
        limit ${limit}
        for update skip locked
      )
      returning id`);
    if (result.rows.length === 0) return [];
    const ids = result.rows.map((r) => Number(r.id));
    return db.select().from(snapshots).where(sql`${snapshots.id} in ${ids}`);
  }

  async function finish(row: SnapshotRow, patch: Partial<SnapshotRow>): Promise<void> {
    await db.update(snapshots).set(patch).where(eq(snapshots.id, row.id));
    const status = patch.summaryStatus ?? row.summaryStatus;
    deps.events.emit({ type: "summary.updated", competitorId: row.competitorId, snapshotId: row.id, status });
  }

  async function processOne(row: SnapshotRow): Promise<void> {
    if (!llm) {
      await finish(row, { summaryStatus: "disabled", summaryNextAttemptAt: null });
      return;
    }

    const budget = await reserveLlmCall(db, { dailyCap: config.LLM_DAILY_CAP, paceHourly: config.LLM_PACE_HOURLY });
    if (!budget.allowed && budget.reason === "paced") {
      // Not a failure: the hourly slice is used up. Queue for the next hour; the diff is already visible.
      logger.info({ snapshotId: row.id, retryAt: budget.retryAt }, "LLM hourly budget used; summary queued");
      await finish(row, {
        summaryAttempts: row.summaryAttempts - 1, // pacing is not an attempt
        summaryError: `Hourly LLM budget used (${budget.used}/${config.LLM_DAILY_CAP} today); queued for ${budget.retryAt?.toISOString() ?? "later"}`,
        summaryNextAttemptAt: budget.retryAt,
      });
      return;
    }
    if (!budget.allowed) {
      logger.warn({ snapshotId: row.id }, "LLM daily cap reached; summary skipped");
      await finish(row, {
        summaryStatus: "cap_reached",
        summaryError: `Daily cap of ${config.LLM_DAILY_CAP} LLM calls reached`,
        summaryNextAttemptAt: null,
      });
      return;
    }

    const messages = buildSummaryMessages({
      competitorId: row.competitorId,
      fetchedAt: row.fetchedAt,
      changes: row.changes ?? [],
    });
    const result = await llm.complete(messages);

    if (result.kind === "ok") {
      await finish(row, {
        summary: result.content,
        summaryStatus: "ok",
        summarySource: "llm",
        summaryModel: result.model,
        summaryError: null,
        summaryNextAttemptAt: null,
      });
      logger.info({ snapshotId: row.id, used: budget.used }, "summary stored");
      return;
    }

    if (result.kind === "unusable") {
      await finish(row, { summaryStatus: "unusable", summaryError: result.message, summaryNextAttemptAt: null });
      logger.warn({ snapshotId: row.id, reason: result.message }, "LLM answer unusable");
      return;
    }

    if (!result.retryable || row.summaryAttempts >= config.LLM_MAX_ATTEMPTS) {
      await finish(row, { summaryStatus: "failed", summaryError: result.message, summaryNextAttemptAt: null });
      logger.error(
        { snapshotId: row.id, attempts: row.summaryAttempts, retryable: result.retryable, error: result.message },
        "LLM call failed; giving up",
      );
      return;
    }
    const backoffMs = Math.min(60_000, 5_000 * 2 ** (row.summaryAttempts - 1));
    await finish(row, {
      summaryError: result.message,
      summaryNextAttemptAt: new Date(Date.now() + backoffMs),
    });
    logger.warn({ snapshotId: row.id, attempt: row.summaryAttempts, backoffMs, error: result.message }, "LLM call failed; will retry");
  }

  async function loop(): Promise<void> {
    while (running) {
      try {
        const rows = await claim(config.LLM_CONCURRENCY);
        for (const row of rows) {
          const release = await semaphore.acquire();
          const task = processOne(row)
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
