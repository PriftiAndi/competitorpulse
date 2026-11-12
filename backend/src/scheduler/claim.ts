import { sql } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { intervalSql } from "./interval.js";

/**
 * Claims up to `limit` competitors that are due for a poll and, in the same
 * statement, schedules their next poll using the adaptive interval.
 * `FOR UPDATE SKIP LOCKED` makes concurrent claimers (several backend
 * instances) take disjoint sets without coordination.
 */
export async function claimDueCompetitors(db: Db, config: Config, limit: number): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    update competitors
    set next_poll_at = now() + make_interval(secs => ${intervalSql(config)})
    where id in (
      select id from competitors
      where removed_at is null and next_poll_at <= now()
      order by next_poll_at
      limit ${limit}
      for update skip locked
    )
    returning id`);
  return result.rows.map((r) => r.id);
}
