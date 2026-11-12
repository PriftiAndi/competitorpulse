import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { competitors } from "../db/schema.js";
import { recordPoll, type PollOutcome } from "../domain/snapshots.js";
import { normalizeListing } from "../source/normalize.js";
import { testDb } from "../test/db.js";

const { db, reset, close } = await testDb();
afterAll(close);

const base = { title: "Acme CRM", tagline: "Simple CRM", price: "$39/mo", description: "Track leads." };
const listing = (over: Record<string, unknown> = {}): PollOutcome => ({ kind: "listing", listing: normalizeListing({ ...base, ...over }) });
const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 10, 0, s));
const opts = { llmEnabled: true };

async function competitorRow(id: string) {
  const [row] = await db.select().from(competitors).where(eq(competitors.id, id));
  return row!;
}

describe("recordPoll", () => {
  beforeEach(async () => {
    await reset();
    await db.insert(competitors).values({ id: "acme" });
  });

  it("stores the first observation without a change and starts the unchanged streak", async () => {
    const snap = await recordPoll(db, "acme", listing(), at(0), opts);
    expect(snap).toMatchObject({ status: "ok", changed: false, summaryStatus: "no_previous", price: "$39/mo" });
    expect(await competitorRow("acme")).toMatchObject({ lastStatus: "ok", unchangedStreak: 1, lastChangedAt: null });
  });

  it("ignores formatting noise and counts the streak up", async () => {
    await recordPoll(db, "acme", listing(), at(0), opts);
    const snap = await recordPoll(db, "acme", listing({ price: "USD 39.00 per month", title: "  Acme&nbsp;CRM " }), at(1), opts);
    expect(snap).toMatchObject({ changed: false, summaryStatus: "not_needed" });
    expect((await competitorRow("acme")).unchangedStreak).toBe(2);
  });

  it("summarises a price-only change by rule and resets the streak", async () => {
    await recordPoll(db, "acme", listing(), at(0), opts);
    await recordPoll(db, "acme", listing(), at(1), opts);
    const snap = await recordPoll(db, "acme", listing({ price: "$29/mo" }), at(2), opts);
    expect(snap).toMatchObject({
      changed: true,
      summaryStatus: "ok",
      summarySource: "rule",
      summary: "Price dropped from $39/mo to $29/mo (26%).",
      changes: [{ field: "price", before: "$39/mo", after: "$29/mo" }],
    });
    expect(await competitorRow("acme")).toMatchObject({ unchangedStreak: 0, lastChangedAt: at(2) });
  });

  it("queues a multi-field change for the LLM, or marks it disabled when there is none", async () => {
    await recordPoll(db, "acme", listing(), at(0), opts);
    const queued = await recordPoll(db, "acme", listing({ price: "$29/mo", tagline: "New" }), at(1), opts);
    expect(queued).toMatchObject({ changed: true, summaryStatus: "pending", summaryNextAttemptAt: at(1) });

    const disabled = await recordPoll(db, "acme", listing({ price: "$19/mo", tagline: "Newer" }), at(2), { llmEnabled: false });
    expect(disabled).toMatchObject({ changed: true, summaryStatus: "disabled" });
  });

  it("carries missing fields forward on a partial response", async () => {
    await recordPoll(db, "acme", listing(), at(0), opts);
    const snap = await recordPoll(db, "acme", listing({ description: null }), at(1), opts);
    expect(snap).toMatchObject({ status: "partial", changed: false, description: "Track leads.", missingFields: ["description"] });
  });

  it("records failed polls without touching the known state or the streak", async () => {
    await recordPoll(db, "acme", listing(), at(0), opts);
    const failed = await recordPoll(db, "acme", { kind: "error", message: "HTTP 502" }, at(1), opts);
    expect(failed).toMatchObject({ status: "error", error: "HTTP 502", changed: false, summaryStatus: "poll_failed" });
    expect((await competitorRow("acme")).unchangedStreak).toBe(1);
    // The next real poll still compares against the last good listing.
    const next = await recordPoll(db, "acme", listing({ price: "$29/mo" }), at(2), opts);
    expect(next?.changes).toEqual([{ field: "price", before: "$39/mo", after: "$29/mo" }]);
  });

  it("treats delisting and relisting as rule-summarised changes", async () => {
    await recordPoll(db, "acme", listing(), at(0), opts);
    const gone = await recordPoll(db, "acme", { kind: "not_found" }, at(1), opts);
    expect(gone).toMatchObject({ status: "not_found", changed: true, summarySource: "rule" });
    const stillGone = await recordPoll(db, "acme", { kind: "not_found" }, at(2), opts);
    expect(stillGone).toMatchObject({ changed: false, summaryStatus: "not_needed" });
    const back = await recordPoll(db, "acme", listing(), at(3), opts);
    expect(back).toMatchObject({ changed: true, summarySource: "rule", summary: expect.stringContaining("available again") as string });
    const backChanged = await recordPoll(db, "acme", { kind: "not_found" }, at(4), opts).then(() =>
      recordPoll(db, "acme", listing({ price: "$59/mo", tagline: "Pro" }), at(5), opts),
    );
    expect(backChanged?.changes?.map((c) => c.field)).toEqual(["availability", "tagline", "price"]);
    expect(backChanged?.summaryStatus).toBe("pending");
  });

  it("drops polls for competitors removed meanwhile", async () => {
    await db.update(competitors).set({ removedAt: new Date() }).where(eq(competitors.id, "acme"));
    expect(await recordPoll(db, "acme", listing(), at(0), opts)).toBeNull();
    expect(await recordPoll(db, "ghost", listing(), at(0), opts)).toBeNull();
  });
});
