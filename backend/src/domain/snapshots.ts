import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client.js";
import { competitors, snapshots, type NewSnapshotRow, type SnapshotRow } from "../db/schema.js";
import type { FetchOutcome } from "../source/client.js";
import type { NormalizedListing, PricePeriod } from "../source/normalize.js";
import { diffObservation, type KnownState } from "./diff.js";
import { priceOnlySummary } from "./ruleSummary.js";

export type PollOutcome = Exclude<FetchOutcome, { kind: "rate_limited" }>;

export type RecordPollOptions = {
  /** Whether an LLM is configured; when false, changes get summary_status 'disabled'. */
  llmEnabled: boolean;
};

/** Rebuilds the normalised listing from a stored snapshot row. */
export function listingFromRow(row: SnapshotRow): NormalizedListing {
  const amount = row.priceAmount === null ? null : Number(row.priceAmount);
  return {
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    price: row.price,
    priceParts:
      amount === null
        ? null
        : { amount, currency: row.priceCurrency, period: (row.pricePeriod as PricePeriod | null) ?? null },
    missingFields: row.missingFields as NormalizedListing["missingFields"],
  };
}

async function loadKnownState(db: DbOrTx, competitorId: string): Promise<KnownState | null> {
  const [latest] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.competitorId, competitorId), inArray(snapshots.status, ["ok", "partial", "not_found"])))
    .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
    .limit(1);
  if (!latest) return null;
  if (latest.status !== "not_found") return { kind: "listed", listing: listingFromRow(latest) };

  const [lastListed] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.competitorId, competitorId), inArray(snapshots.status, ["ok", "partial"])))
    .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
    .limit(1);
  return { kind: "delisted", lastListing: lastListed ? listingFromRow(lastListed) : null };
}

/**
 * Persists the result of one poll, computes whether it is a change that
 * matters, and decides what should happen about a summary. The poll result is
 * always stored first; the LLM is never on this path.
 */
export async function recordPoll(
  db: Db,
  competitorId: string,
  outcome: PollOutcome,
  fetchedAt: Date,
  opts: RecordPollOptions,
): Promise<SnapshotRow | null> {
  return db.transaction(async (tx) => {
    // Serialise polls per competitor (scheduled poll vs. manual poll).
    const [competitor] = await tx
      .select()
      .from(competitors)
      .where(eq(competitors.id, competitorId))
      .for("update");
    if (!competitor || competitor.removedAt !== null) return null;

    const previous = await loadKnownState(tx, competitorId);
    const row = buildSnapshot(competitorId, outcome, fetchedAt, previous, opts);

    const [inserted] = await tx.insert(snapshots).values(row).returning();
    const streak = row.changed ? 0 : row.status === "error" ? competitor.unchangedStreak : competitor.unchangedStreak + 1;
    await tx
      .update(competitors)
      .set({
        lastPolledAt: fetchedAt,
        lastStatus: row.status,
        unchangedStreak: streak,
        ...(row.changed ? { lastChangedAt: fetchedAt } : {}),
      })
      .where(eq(competitors.id, competitorId));
    return inserted ?? null;
  });
}

function buildSnapshot(
  competitorId: string,
  outcome: PollOutcome,
  fetchedAt: Date,
  previous: KnownState | null,
  opts: RecordPollOptions,
): NewSnapshotRow {
  const base = { competitorId, fetchedAt };

  if (outcome.kind === "error") {
    return { ...base, status: "error", error: outcome.message, changed: false, summaryStatus: "poll_failed" };
  }

  if (outcome.kind === "not_found") {
    const diff = diffObservation(previous, { kind: "delisted" });
    if (!diff.changed) {
      return { ...base, status: "not_found", changed: false, summaryStatus: previous ? "not_needed" : "no_previous" };
    }
    // Availability changes are summarised by a rule: no need to spend an LLM call.
    return {
      ...base,
      status: "not_found",
      changed: true,
      changes: diff.changes,
      summary: "The listing is no longer available at the source.",
      summaryStatus: "ok",
      summarySource: "rule",
    };
  }

  const diff = diffObservation(previous, { kind: "listed", listing: outcome.listing });
  const listing = diff.effective ?? outcome.listing;
  const fields = {
    title: listing.title,
    tagline: listing.tagline,
    price: listing.price,
    priceAmount: listing.priceParts ? listing.priceParts.amount.toFixed(2) : null,
    priceCurrency: listing.priceParts?.currency ?? null,
    pricePeriod: listing.priceParts?.period ?? null,
    description: listing.description,
    missingFields: listing.missingFields,
  };
  const status = listing.missingFields.length > 0 ? ("partial" as const) : ("ok" as const);

  if (previous === null) {
    return { ...base, ...fields, status, changed: false, summaryStatus: "no_previous" };
  }
  if (!diff.changed) {
    return { ...base, ...fields, status, changed: false, summaryStatus: "not_needed" };
  }

  const onlyRelisted = diff.changes.length === 1 && diff.changes[0]?.field === "availability";
  if (onlyRelisted) {
    return {
      ...base,
      ...fields,
      status,
      changed: true,
      changes: diff.changes,
      summary: "The listing is available again at the source, unchanged since it was last seen.",
      summaryStatus: "ok",
      summarySource: "rule",
    };
  }

  // A price-only change is the most common change and needs no model to describe.
  const previousListing = previous.kind === "listed" ? previous.listing : previous.lastListing;
  const priceSummary = previousListing ? priceOnlySummary(diff.changes, previousListing, listing) : null;
  if (priceSummary) {
    return {
      ...base,
      ...fields,
      status,
      changed: true,
      changes: diff.changes,
      summary: priceSummary,
      summaryStatus: "ok",
      summarySource: "rule",
    };
  }

  return {
    ...base,
    ...fields,
    status,
    changed: true,
    changes: diff.changes,
    summaryStatus: opts.llmEnabled ? "pending" : "disabled",
    summaryNextAttemptAt: opts.llmEnabled ? fetchedAt : null,
  };
}

/** Deletes history older than the retention window, in bounded batches. */
export async function pruneSnapshots(db: Db, retentionDays: number, batch = 10_000): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      delete from snapshots where id in (
        select id from snapshots
        where fetched_at < now() - make_interval(days => ${retentionDays})
        limit ${batch}
      )`);
    const deleted = result.rowCount ?? 0;
    total += deleted;
    if (deleted < batch) return total;
  }
}
