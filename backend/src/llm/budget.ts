import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

/** UTC day as YYYY-MM-DD; the cap is a per-day budget. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * How many calls may have been made by this point of the UTC day when pacing
 * is on: the cap is released linearly, one 24th per hour, so unused budget
 * rolls forward but a burst at 09:00 cannot drain the afternoon.
 */
export function pacedAllowance(dailyCap: number, now = new Date()): number {
  const hour = now.getUTCHours();
  return Math.min(dailyCap, Math.ceil((dailyCap * (hour + 1)) / 24));
}

export function nextHourStart(now = new Date()): Date {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

export type BudgetDecision =
  | { allowed: true; used: number }
  | { allowed: false; reason: "daily_cap" | "paced"; used: number; retryAt: Date | null };

/**
 * Atomically reserves one LLM call for today. The conditional upsert either
 * increments or does nothing, in one statement, so it is safe under concurrency.
 */
export async function reserveLlmCall(
  db: Db,
  opts: { dailyCap: number; paceHourly: boolean },
  now = new Date(),
): Promise<BudgetDecision> {
  if (opts.dailyCap <= 0) return { allowed: false, reason: "daily_cap", used: 0, retryAt: null };
  const limit = opts.paceHourly ? pacedAllowance(opts.dailyCap, now) : opts.dailyCap;
  const day = utcDay(now);

  const result = await db.execute<{ calls: number }>(sql`
    insert into llm_usage (day, calls) values (${day}, 1)
    on conflict (day) do update set calls = llm_usage.calls + 1
    where llm_usage.calls < ${limit}
    returning calls`);
  const row = result.rows[0];
  if (row) return { allowed: true, used: Number(row.calls) };

  const used = await llmCallsToday(db, now);
  if (used >= opts.dailyCap) return { allowed: false, reason: "daily_cap", used, retryAt: null };
  return { allowed: false, reason: "paced", used, retryAt: nextHourStart(now) };
}

export async function llmCallsToday(db: Db, now = new Date()): Promise<number> {
  const result = await db.execute<{ calls: number }>(sql`select calls from llm_usage where day = ${utcDay(now)}`);
  return Number(result.rows[0]?.calls ?? 0);
}
