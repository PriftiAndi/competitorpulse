import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { competitors, snapshots } from "../db/schema.js";
import { claimPendingSummaries, SUMMARY_LEASE_MS } from "../llm/claim.js";
import { claimDueCompetitors } from "../scheduler/claim.js";
import { testDb } from "../test/db.js";

const { db, reset, close } = await testDb();
afterAll(close);

const config = loadConfig({ POLL_INTERVAL_SECONDS: "60", POLL_MAX_INTERVAL_SECONDS: "240", POLL_BACKOFF_EVERY: "10" });
const past = new Date(Date.now() - 1000);
const future = new Date(Date.now() + 60_000);

describe("claimDueCompetitors", () => {
  beforeEach(reset);

  it("claims only due, active competitors and reschedules them with the adaptive interval", async () => {
    await db.insert(competitors).values([
      { id: "due-a", nextPollAt: past, unchangedStreak: 0 },
      { id: "due-b", nextPollAt: past, unchangedStreak: 10 }, // one doubling => 120s
      { id: "due-c", nextPollAt: past, unchangedStreak: 50 }, // capped => 240s
      { id: "later", nextPollAt: future },
      { id: "removed", nextPollAt: past, removedAt: new Date() },
    ]);
    const ids = await claimDueCompetitors(db, config, 10);
    expect(ids.sort()).toEqual(["due-a", "due-b", "due-c"]);
    expect(await claimDueCompetitors(db, config, 10)).toEqual([]);

    const rows = await db.select().from(competitors);
    const next = Object.fromEntries(rows.map((r) => [r.id, (r.nextPollAt.getTime() - Date.now()) / 1000]));
    expect(next["due-a"]).toBeGreaterThan(55);
    expect(next["due-a"]).toBeLessThan(65);
    expect(next["due-b"]).toBeGreaterThan(115);
    expect(next["due-c"]).toBeGreaterThan(235);
  });

  it("hands concurrent claimers disjoint sets", async () => {
    await db.insert(competitors).values(Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, nextPollAt: past })));
    const batches = await Promise.all([claimDueCompetitors(db, config, 7), claimDueCompetitors(db, config, 7), claimDueCompetitors(db, config, 7)]);
    const all = batches.flat();
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
  });
});

describe("claimPendingSummaries", () => {
  beforeEach(async () => {
    await reset();
    await db.insert(competitors).values({ id: "acme" });
  });

  const pending = (changes: Array<{ field: string }>, secondsAgo: number) => ({
    competitorId: "acme",
    fetchedAt: new Date(Date.now() - secondsAgo * 1000),
    status: "ok" as const,
    changed: true,
    changes: changes.map((c) => ({ ...c, before: "a", after: "b" })) as never,
    summaryStatus: "pending" as const,
    summaryNextAttemptAt: new Date(Date.now() - secondsAgo * 1000),
  });

  it("prioritises price and availability changes over copy-only changes, oldest first within a tier", async () => {
    await db.insert(snapshots).values([
      pending([{ field: "description" }], 30),
      pending([{ field: "tagline" }], 20),
      pending([{ field: "title" }, { field: "price" }], 10),
      pending([{ field: "availability" }, { field: "tagline" }], 5),
    ]);
    const claimed = await claimPendingSummaries(db, 10);
    expect(claimed.map((r) => r.changes?.map((c) => c.field))).toEqual([
      ["title", "price"],
      ["availability", "tagline"],
      ["description"],
      ["tagline"],
    ]);
  });

  it("spends a tight budget on the important changes first", async () => {
    await db.insert(snapshots).values([
      pending([{ field: "description" }], 30),
      pending([{ field: "tagline" }], 20),
      pending([{ field: "price" }], 10),
      pending([{ field: "availability" }, { field: "title" }], 5),
    ]);
    const claimed = await claimPendingSummaries(db, 2);
    expect(claimed.map((r) => r.changes?.map((c) => c.field))).toEqual([["price"], ["availability", "title"]]);
    const rest = await claimPendingSummaries(db, 10);
    expect(rest.map((r) => r.changes?.[0]?.field)).toEqual(["description", "tagline"]);
  });

  it("leases claimed rows, counts the attempt, and leaves them for retry after the lease", async () => {
    await db.insert(snapshots).values([pending([{ field: "tagline" }], 1)]);
    const [first] = await claimPendingSummaries(db, 10);
    expect(first?.summaryAttempts).toBe(1);
    expect(first!.summaryNextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(SUMMARY_LEASE_MS - 5000);
    expect(await claimPendingSummaries(db, 10)).toEqual([]);

    await db.update(snapshots).set({ summaryNextAttemptAt: sql`now()` }).where(eq(snapshots.id, first!.id));
    const [again] = await claimPendingSummaries(db, 10);
    expect(again?.summaryAttempts).toBe(2);
  });
});
