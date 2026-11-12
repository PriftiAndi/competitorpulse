import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { competitors } from "../db/schema.js";
import { recordPoll } from "../domain/snapshots.js";
import { createEventBus, type DomainEvent } from "../events.js";
import { buildApp } from "../http/app.js";
import { normalizeListing } from "../source/normalize.js";
import { testDb } from "../test/db.js";

const { db, reset, close } = await testDb();
const events: DomainEvent[] = [];
const bus = createEventBus();
bus.subscribe((e) => events.push(e));
const app = buildApp({
  db,
  config: { ...loadConfig({ LOG_LEVEL: "silent" }) },
  pollerStats: () => ({ running: true, inFlight: 0, polls: 0, rateLimitedUntil: null, lastTickAt: null }),
  llmModel: "fake",
  events: bus,
});
afterAll(async () => {
  await app.close();
  await close();
});

const json = (res: { body: string }) => JSON.parse(res.body) as unknown;

describe("HTTP API", () => {
  beforeEach(async () => {
    await reset();
    events.length = 0;
  });

  it("implements the required contract", async () => {
    expect((await app.inject({ method: "GET", url: "/api/competitors" })).statusCode).toBe(200);
    const created = await app.inject({ method: "POST", url: "/api/competitors", payload: { id: " Acme-CRM " } });
    expect(created.statusCode).toBe(201);
    expect(json(created)).toMatchObject({ id: "acme-crm", changedInLast24h: false, intervalSeconds: 60 });
    expect(events).toEqual([{ type: "competitor.added", competitorId: "acme-crm" }]);

    const list = json(await app.inject({ method: "GET", url: "/api/competitors" })) as Array<{ id: string }>;
    expect(list.map((c) => c.id)).toEqual(["acme-crm"]);

    const snaps = await app.inject({ method: "GET", url: "/api/competitors/acme-crm/snapshots" });
    expect(snaps.statusCode).toBe(200);
    expect(json(snaps)).toEqual([]);

    const removed = await app.inject({ method: "DELETE", url: "/api/competitors/acme-crm" });
    expect(removed.statusCode).toBe(204);
    expect(events.at(-1)).toEqual({ type: "competitor.removed", competitorId: "acme-crm" });
    expect((await app.inject({ method: "DELETE", url: "/api/competitors/acme-crm" })).statusCode).toBe(404);
  });

  it("validates ids and rejects duplicates", async () => {
    expect((await app.inject({ method: "POST", url: "/api/competitors", payload: { id: "Bad Id!" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/competitors", payload: {} })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/competitors", payload: { id: "dup" } });
    expect((await app.inject({ method: "POST", url: "/api/competitors", payload: { id: "dup" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/api/competitors/missing/snapshots" })).statusCode).toBe(404);
  });

  it("restores history when a removed competitor is re-added", async () => {
    await db.insert(competitors).values({ id: "acme" });
    await recordPoll(db, "acme", { kind: "listing", listing: normalizeListing({ title: "A", price: "$1/mo" }) }, new Date(), { llmEnabled: true });
    await app.inject({ method: "DELETE", url: "/api/competitors/acme" });
    expect((await app.inject({ method: "GET", url: "/api/competitors/acme/snapshots" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/competitors", payload: { id: "acme" } })).statusCode).toBe(201);
    expect(json(await app.inject({ method: "GET", url: "/api/competitors/acme/snapshots" }))).toHaveLength(1);
  });

  it("returns snapshots newest first with the explanation fields, and pages with ?before", async () => {
    await db.insert(competitors).values({ id: "acme" });
    const t = (s: number) => new Date(Date.UTC(2026, 10, 12, 10, 0, s));
    await recordPoll(db, "acme", { kind: "listing", listing: normalizeListing({ title: "A", price: "$1/mo" }) }, t(0), { llmEnabled: true });
    await recordPoll(db, "acme", { kind: "listing", listing: normalizeListing({ title: "A", price: "$2/mo" }) }, t(1), { llmEnabled: true });
    await recordPoll(db, "acme", { kind: "error", message: "HTTP 500" }, t(2), { llmEnabled: true });

    const all = json(await app.inject({ method: "GET", url: "/api/competitors/acme/snapshots" })) as Array<Record<string, unknown>>;
    expect(all.map((s) => s.fetchedAt)).toEqual([t(2).toISOString(), t(1).toISOString(), t(0).toISOString()]);
    expect(all[0]).toMatchObject({ status: "error", summary: null, summaryStatus: "poll_failed", summaryReason: expect.stringContaining("poll failed") as string });
    expect(all[1]).toMatchObject({ changed: true, summarySource: "rule", changes: [{ field: "price", before: "$1/mo", after: "$2/mo" }] });
    for (const key of ["fetchedAt", "title", "tagline", "price", "description", "changed", "summary"]) expect(all[0]).toHaveProperty(key);

    const page = json(await app.inject({ method: "GET", url: `/api/competitors/acme/snapshots?limit=1&before=${all[0]!.id as number}` })) as Array<Record<string, unknown>>;
    expect(page).toHaveLength(1);
    expect(page[0]!.id).toBe(all[1]!.id);
  });

  it("accepts a bodiless POST with a JSON content-type and queues a poll", async () => {
    await db.insert(competitors).values({ id: "acme", nextPollAt: new Date(Date.now() + 60_000) });
    const res = await app.inject({ method: "POST", url: "/api/competitors/acme/poll", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(202);
    const [row] = await db.select().from(competitors);
    expect(row!.nextPollAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("exposes status and health", async () => {
    expect(json(await app.inject({ method: "GET", url: "/api/health" }))).toEqual({ ok: true });
    expect(json(await app.inject({ method: "GET", url: "/api/status" }))).toMatchObject({ llm: { enabled: true, model: "fake", callsToday: 0 }, config: { pollIntervalSeconds: 60 } });
  });
});
