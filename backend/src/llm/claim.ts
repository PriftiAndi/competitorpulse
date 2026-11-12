import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { snapshots, type SnapshotRow } from "../db/schema.js";

/** How long a claimed row is invisible to other workers; covers a crash mid-call. */
export const SUMMARY_LEASE_MS = 120_000;

/**
 * Claims up to `limit` snapshots waiting for a summary, leasing them for
 * SUMMARY_LEASE_MS and counting the attempt. When the budget is tight the
 * order matters: changes a product manager acts on (price, availability)
 * go before copy-only changes; within a tier, oldest first.
 */
export async function claimPendingSummaries(db: Db, limit: number): Promise<SnapshotRow[]> {
  const result = await db.execute<{ id: number }>(sql`
    update snapshots
    set summary_attempts = summary_attempts + 1,
        summary_next_attempt_at = now() + make_interval(secs => ${SUMMARY_LEASE_MS / 1000})
    where id in (
      select id from snapshots
      where summary_status = 'pending' and summary_next_attempt_at <= now()
      order by
        (changes @> '[{"field":"price"}]'::jsonb or changes @> '[{"field":"availability"}]'::jsonb) desc,
        summary_next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id`);
  if (result.rows.length === 0) return [];
  const ids = result.rows.map((r) => Number(r.id));
  // RETURNING does not preserve the subquery's order, so order the batch again here.
  return db
    .select()
    .from(snapshots)
    .where(sql`${snapshots.id} in ${ids}`)
    .orderBy(
      sql`(changes @> '[{"field":"price"}]'::jsonb or changes @> '[{"field":"availability"}]'::jsonb) desc`,
      snapshots.fetchedAt,
    );
}
