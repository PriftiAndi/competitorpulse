import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { llmCallsToday, reserveLlmCall } from "../llm/budget.js";
import { testDb } from "../test/db.js";

const { db, reset, close } = await testDb();
afterAll(close);

describe("reserveLlmCall", () => {
  beforeEach(reset);

  it("never hands out more than the cap under concurrency", async () => {
    const decisions = await Promise.all(
      Array.from({ length: 40 }, () => reserveLlmCall(db, { dailyCap: 15, paceHourly: false })),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(15);
    expect(decisions.filter((d) => !d.allowed && d.reason === "daily_cap")).toHaveLength(25);
    expect(await llmCallsToday(db)).toBe(15);
  });

  it("paces the cap across the day and says when to retry", async () => {
    const at9 = new Date(Date.UTC(2026, 10, 12, 9, 30));
    // cap 240 => 10/hour; by 09:30 the allowance is 100
    for (let i = 0; i < 100; i += 1) expect((await reserveLlmCall(db, { dailyCap: 240, paceHourly: true }, at9)).allowed).toBe(true);
    const paced = await reserveLlmCall(db, { dailyCap: 240, paceHourly: true }, at9);
    expect(paced).toMatchObject({ allowed: false, reason: "paced", used: 100 });
    expect(paced.allowed === false && paced.retryAt?.toISOString()).toBe("2026-11-12T10:00:00.000Z");

    // At 10:00 the next slice opens.
    const at10 = new Date(Date.UTC(2026, 10, 12, 10, 0));
    expect((await reserveLlmCall(db, { dailyCap: 240, paceHourly: true }, at10)).allowed).toBe(true);
  });

  it("distinguishes the hard daily cap from pacing", async () => {
    const endOfDay = new Date(Date.UTC(2026, 10, 12, 23, 59));
    for (let i = 0; i < 3; i += 1) await reserveLlmCall(db, { dailyCap: 3, paceHourly: true }, endOfDay);
    expect(await reserveLlmCall(db, { dailyCap: 3, paceHourly: true }, endOfDay)).toMatchObject({ allowed: false, reason: "daily_cap", retryAt: null });
    expect(await reserveLlmCall(db, { dailyCap: 0, paceHourly: true }, endOfDay)).toMatchObject({ allowed: false, reason: "daily_cap" });
  });

  it("resets with the UTC day", async () => {
    const day1 = new Date(Date.UTC(2026, 10, 12, 23, 59));
    const day2 = new Date(Date.UTC(2026, 10, 13, 0, 1));
    await reserveLlmCall(db, { dailyCap: 1, paceHourly: false }, day1);
    expect((await reserveLlmCall(db, { dailyCap: 1, paceHourly: false }, day1)).allowed).toBe(false);
    expect((await reserveLlmCall(db, { dailyCap: 1, paceHourly: false }, day2)).allowed).toBe(true);
  });
});
