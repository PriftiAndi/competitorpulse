import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * What a single poll of the source produced.
 *  - ok:        full listing received
 *  - partial:   listing received but at least one field was missing/empty/null
 *  - not_found: the source answered 404 (unknown id, or temporarily delisted)
 *  - error:     5xx, timeout, network error, unparseable body
 */
export const snapshotStatus = pgEnum("snapshot_status", ["ok", "partial", "not_found", "error"]);

/**
 * Why a snapshot has (or has not) a summary. The UI shows this to the user.
 *  - ok:          summary stored
 *  - pending:     a change was detected; the summary worker has not finished yet
 *  - failed:      the LLM call failed (timeout/5xx/network) after all attempts
 *  - unusable:    the LLM answered, but the content was empty or malformed
 *  - cap_reached: the daily LLM budget was exhausted when the change was detected
 *  - disabled:    no LLM is configured
 *  - not_needed:  nothing that matters changed, so no summary was requested
 *  - no_previous: first observation of this competitor, nothing to compare with
 *  - poll_failed: the poll itself failed, so there is nothing to summarise
 */
export const summaryStatus = pgEnum("summary_status", [
  "ok",
  "pending",
  "failed",
  "unusable",
  "cap_reached",
  "disabled",
  "not_needed",
  "no_previous",
  "poll_failed",
]);

export const competitors = pgTable(
  "competitors",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft delete: removing a competitor stops polling but keeps its history.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull().defaultNow(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastStatus: snapshotStatus("last_status"),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    // Consecutive polls without a change that matters; drives the adaptive interval.
    unchangedStreak: integer("unchanged_streak").notNull().default(0),
  },
  (t) => [index("competitors_next_poll_idx").on(t.nextPollAt).where(sqlRemovedAtIsNull())],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    status: snapshotStatus("status").notNull(),

    // Normalised listing fields. For a partial poll the missing fields are carried
    // forward from the previous known state and listed in missing_fields.
    title: text("title"),
    tagline: text("tagline"),
    price: text("price"),
    priceAmount: numeric("price_amount", { precision: 12, scale: 2 }),
    priceCurrency: text("price_currency"),
    pricePeriod: text("price_period"),
    description: text("description"),
    missingFields: jsonb("missing_fields").$type<string[]>().notNull().default([]),
    error: text("error"),

    // Diff against the previous known state
    changed: boolean("changed").notNull().default(false),
    changes: jsonb("changes").$type<FieldChange[]>(),

    // LLM summary lifecycle
    summary: text("summary"),
    summaryStatus: summaryStatus("summary_status").notNull(),
    summarySource: text("summary_source"), // 'llm' | 'rule'
    summaryError: text("summary_error"),
    summaryAttempts: integer("summary_attempts").notNull().default(0),
    summaryNextAttemptAt: timestamp("summary_next_attempt_at", { withTimezone: true }),
    summaryModel: text("summary_model"),
  },
  (t) => [
    index("snapshots_competitor_fetched_idx").on(t.competitorId, t.fetchedAt.desc()),
    index("snapshots_fetched_idx").on(t.fetchedAt),
    index("snapshots_summary_pending_idx")
      .on(t.summaryNextAttemptAt)
      .where(sqlSummaryPending()),
  ],
);

/** One row per UTC day; the LLM budget counter. */
export const llmUsage = pgTable("llm_usage", {
  day: date("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
});

export type FieldChange = {
  field: "availability" | "title" | "tagline" | "price" | "description";
  before: string | null;
  after: string | null;
};

export type CompetitorRow = typeof competitors.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type NewSnapshotRow = typeof snapshots.$inferInsert;
export type SnapshotStatus = SnapshotRow["status"];
export type SummaryStatus = SnapshotRow["summaryStatus"];

function sqlRemovedAtIsNull() {
  return sql`removed_at is null`;
}
function sqlSummaryPending() {
  return sql`summary_status = 'pending'`;
}
