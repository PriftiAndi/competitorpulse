import { sql, type SQL } from "drizzle-orm";
import type { Config } from "../config.js";

type IntervalConfig = Pick<Config, "POLL_INTERVAL_SECONDS" | "POLL_MAX_INTERVAL_SECONDS" | "POLL_BACKOFF_EVERY">;

/**
 * Adaptive polling interval: base * 2^floor(streak / every), capped.
 * A competitor that never changes drifts to the maximum; one change brings it
 * straight back to the base. Same formula in SQL (claim query) and TS (API).
 */
export function intervalForStreak(streak: number, cfg: IntervalConfig): number {
  const doublings = Math.floor(Math.max(0, streak) / cfg.POLL_BACKOFF_EVERY);
  return Math.min(cfg.POLL_MAX_INTERVAL_SECONDS, cfg.POLL_INTERVAL_SECONDS * 2 ** doublings);
}

export function intervalSql(cfg: IntervalConfig): SQL {
  return sql`least(
    ${cfg.POLL_MAX_INTERVAL_SECONDS}::float8,
    ${cfg.POLL_INTERVAL_SECONDS}::float8 * power(2, floor(unchanged_streak::float8 / ${cfg.POLL_BACKOFF_EVERY}))
  )`;
}
