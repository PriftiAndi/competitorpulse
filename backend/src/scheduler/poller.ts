import { sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { EventBus } from "../events.js";
import { recordPoll } from "../domain/snapshots.js";
import type { SourceClient } from "../source/client.js";
import { claimDueCompetitors } from "./claim.js";
import { RateLimiter, Semaphore, sleep } from "./rateLimiter.js";

export type PollerStats = {
  running: boolean;
  inFlight: number;
  polls: number;
  rateLimitedUntil: string | null;
  lastTickAt: string | null;
};

export type Poller = {
  stats(): PollerStats;
  stop(): Promise<void>;
};

const TICK_MS = 1000;

/**
 * Polls every tracked competitor on a fixed interval.
 *
 * Work is claimed from the database with `FOR UPDATE SKIP LOCKED`, so several
 * backend instances can share the load without double-polling. Outgoing
 * requests are paced by a token bucket below the source's global limit, and a
 * 429 pauses everything for the advertised Retry-After.
 */
export function startPoller(deps: {
  db: Db;
  config: Config;
  source: SourceClient;
  logger: FastifyBaseLogger;
  llmEnabled: boolean;
  events: EventBus;
}): Poller {
  const { db, config, source, logger } = deps;
  const limiter = new RateLimiter(config.SOURCE_MAX_RPS);
  const semaphore = new Semaphore(config.SOURCE_CONCURRENCY);
  const inFlight = new Set<Promise<void>>();
  let running = true;
  let polls = 0;
  let lastTickAt: Date | null = null;

  async function pollOne(id: string): Promise<void> {
    const fetchedAt = new Date();
    const outcome = await source.fetchListing(id);
    polls += 1;

    if (outcome.kind === "rate_limited") {
      const waitMs = outcome.retryAfterSeconds * 1000;
      limiter.pauseFor(waitMs);
      logger.warn({ id, retryAfterSeconds: outcome.retryAfterSeconds }, "source rate limit hit, pausing");
      // Put the competitor back at the front of the queue once the pause is over.
      await db.execute(sql`
        update competitors
        set next_poll_at = least(next_poll_at, now() + make_interval(secs => ${outcome.retryAfterSeconds + 1}))
        where id = ${id}`);
      return;
    }

    const snapshot = await recordPoll(db, id, outcome, fetchedAt, { llmEnabled: deps.llmEnabled });
    if (snapshot) {
      deps.events.emit({ type: "snapshot.recorded", competitorId: id, snapshotId: snapshot.id, changed: snapshot.changed });
      logger.info(
        { id, status: snapshot.status, changed: snapshot.changed, summaryStatus: snapshot.summaryStatus },
        "poll recorded",
      );
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      lastTickAt = new Date();
      try {
        if (limiter.isPaused) {
          await sleep(Math.min(TICK_MS, limiter.pausedUntilMs - Date.now()));
          continue;
        }
        const ids = await claimDueCompetitors(db, config, config.POLL_BATCH_SIZE);
        for (const id of ids) {
          if (!running) break;
          const release = await semaphore.acquire();
          await limiter.acquire();
          const task = pollOne(id)
            .catch((err) => logger.error({ err, id }, "poll failed unexpectedly"))
            .finally(() => {
              release();
              inFlight.delete(task);
            });
          inFlight.add(task);
        }
        if (ids.length === 0) await sleep(TICK_MS);
      } catch (err) {
        logger.error({ err }, "scheduler tick failed");
        await sleep(TICK_MS);
      }
    }
  }

  const loopPromise = loop();
  logger.info(
    {
      intervalSeconds: config.POLL_INTERVAL_SECONDS,
      maxIntervalSeconds: config.POLL_MAX_INTERVAL_SECONDS,
      backoffEvery: config.POLL_BACKOFF_EVERY,
      maxRps: config.SOURCE_MAX_RPS,
      concurrency: config.SOURCE_CONCURRENCY,
    },
    "poller started",
  );

  return {
    stats: () => ({
      running,
      inFlight: semaphore.inFlight,
      polls,
      rateLimitedUntil: limiter.isPaused ? new Date(limiter.pausedUntilMs).toISOString() : null,
      lastTickAt: lastTickAt?.toISOString() ?? null,
    }),
    async stop() {
      running = false;
      await loopPromise;
      await Promise.allSettled([...inFlight]);
    },
  };
}
