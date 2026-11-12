import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { competitors, snapshots, type SnapshotRow } from "../db/schema.js";
import { createEventBus, type DomainEvent } from "../events.js";
import { reserveLlmCall } from "../llm/budget.js";
import type { LlmClient, LlmResult } from "../llm/client.js";
import { processSummary } from "../llm/summarizer.js";
import { silentLogger, testDb } from "../test/db.js";

const { db, reset, close } = await testDb();
afterAll(close);

const fakeLlm = (results: LlmResult[]): LlmClient & { calls: number } => {
  const client = {
    model: "fake",
    calls: 0,
    async complete() {
      client.calls += 1;
      return results.shift() ?? ({ kind: "error", message: "exhausted", retryable: true } as LlmResult);
    },
  };
  return client;
};

const config = { LLM_DAILY_CAP: 100, LLM_PACE_HOURLY: false, LLM_MAX_ATTEMPTS: 3 };

async function pendingRow(attempts = 1): Promise<SnapshotRow> {
  const [row] = await db
    .insert(snapshots)
    .values({
      competitorId: "acme",
      fetchedAt: new Date(),
      status: "ok",
      changed: true,
      changes: [{ field: "tagline", before: "a", after: "b" }],
      summaryStatus: "pending",
      summaryAttempts: attempts,
      summaryNextAttemptAt: new Date(),
    })
    .returning();
  return row!;
}
const reload = async (id: number) => (await db.select().from(snapshots).where(eq(snapshots.id, id)))[0]!;

describe("processSummary", () => {
  const events: DomainEvent[] = [];
  const bus = createEventBus();
  bus.subscribe((e) => events.push(e));

  beforeEach(async () => {
    await reset();
    events.length = 0;
    await db.insert(competitors).values({ id: "acme" });
  });

  it("stores a good answer, charges one call, and emits an event", async () => {
    const llm = fakeLlm([{ kind: "ok", content: "Tagline changed.", model: "fake-1" }]);
    const row = await pendingRow();
    expect(await processSummary({ db, config, llm, logger: silentLogger, events: bus }, row)).toBe("ok");
    expect(await reload(row.id)).toMatchObject({ summary: "Tagline changed.", summarySource: "llm", summaryModel: "fake-1", summaryNextAttemptAt: null });
    expect(events).toEqual([{ type: "summary.updated", competitorId: "acme", snapshotId: row.id, status: "ok" }]);
    expect((await reserveLlmCall(db, { dailyCap: 100, paceHourly: false })).used).toBe(2);
  });

  it("schedules a retry with backoff for a transient error, then gives up at max attempts", async () => {
    const llm = fakeLlm([{ kind: "error", message: "HTTP 503", retryable: true }, { kind: "error", message: "timeout", retryable: true }]);
    const deps = { db, config, llm, logger: silentLogger, events: bus };
    const row = await pendingRow(1);
    expect(await processSummary(deps, row)).toBe("pending");
    const after1 = await reload(row.id);
    expect(after1.summaryError).toBe("HTTP 503");
    expect(after1.summaryNextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(4000);

    const last = { ...after1, summaryAttempts: 3 };
    expect(await processSummary(deps, last)).toBe("failed");
    expect((await reload(row.id)).summaryError).toBe("timeout");
  });

  it("fails immediately on a non-retryable error and on an unusable answer", async () => {
    const deps = { db, config, logger: silentLogger, events: bus };
    const a = await pendingRow();
    expect(await processSummary({ ...deps, llm: fakeLlm([{ kind: "error", message: "HTTP 404", retryable: false }]) }, a)).toBe("failed");
    const b = await pendingRow();
    expect(await processSummary({ ...deps, llm: fakeLlm([{ kind: "unusable", message: "empty" }]) }, b)).toBe("unusable");
  });

  it("marks cap_reached without calling the model, and 'disabled' without an LLM", async () => {
    const llm = fakeLlm([{ kind: "ok", content: "never", model: "x" }]);
    for (let i = 0; i < 2; i += 1) await reserveLlmCall(db, { dailyCap: 2, paceHourly: false });
    const row = await pendingRow();
    expect(await processSummary({ db, config: { ...config, LLM_DAILY_CAP: 2 }, llm, logger: silentLogger, events: bus }, row)).toBe("cap_reached");
    expect(llm.calls).toBe(0);

    const other = await pendingRow();
    expect(await processSummary({ db, config, llm: null, logger: silentLogger, events: bus }, other)).toBe("disabled");
  });

  it("re-queues for the next hour when paced, without counting an attempt", async () => {
    const llm = fakeLlm([]);
    const at = new Date(Date.UTC(2026, 10, 12, 0, 30)); // hour 0 => allowance ceil(24/24)=1
    await reserveLlmCall(db, { dailyCap: 24, paceHourly: true }, at);
    const row = await pendingRow(1);
    const status = await processSummary({ db, config: { ...config, LLM_DAILY_CAP: 24, LLM_PACE_HOURLY: true }, llm, logger: silentLogger, events: bus, now: () => at }, row);
    expect(status).toBe("pending");
    const after = await reload(row.id);
    expect(after.summaryAttempts).toBe(0);
    expect(after.summaryNextAttemptAt?.toISOString()).toBe("2026-11-12T01:00:00.000Z");
    expect(after.summaryError).toMatch(/Hourly LLM budget used/);
    expect(llm.calls).toBe(0);
  });
});
