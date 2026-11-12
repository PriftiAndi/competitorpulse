import { describe, expect, it } from "vitest";
import type { SnapshotRow } from "../db/schema.js";
import { summaryReason, toCompetitorDto, toSnapshotDto } from "./dto.js";

const base: SnapshotRow = {
  id: 1,
  competitorId: "acme",
  fetchedAt: new Date("2026-11-12T10:00:00Z"),
  status: "ok",
  title: "Acme",
  tagline: null,
  price: "$29/mo",
  priceAmount: "29.00",
  priceCurrency: "USD",
  pricePeriod: "month",
  description: null,
  missingFields: [],
  error: null,
  changed: false,
  changes: null,
  summary: null,
  summaryStatus: "not_needed",
  summarySource: null,
  summaryError: null,
  summaryAttempts: 0,
  summaryNextAttemptAt: null,
  summaryModel: null,
};

describe("summaryReason", () => {
  const reason = (patch: Partial<SnapshotRow>) => summaryReason({ ...base, ...patch });
  it("explains every status in words a user can act on", () => {
    expect(reason({ summaryStatus: "ok", summarySource: "llm" })).toMatch(/LLM/);
    expect(reason({ summaryStatus: "ok", summarySource: "rule" })).toMatch(/rule/);
    expect(reason({ summaryStatus: "pending" })).toMatch(/being generated/);
    expect(reason({ summaryStatus: "pending", summaryError: "Hourly LLM budget used" })).toMatch(/queued: Hourly/);
    expect(reason({ summaryStatus: "failed", summaryAttempts: 3, summaryError: "timeout" })).toBe("The LLM call failed after 3 attempt(s): timeout");
    expect(reason({ summaryStatus: "unusable", summaryError: "empty" })).toMatch(/unusable: empty/);
    expect(reason({ summaryStatus: "cap_reached" })).toMatch(/daily LLM call cap/);
    expect(reason({ summaryStatus: "disabled" })).toMatch(/No LLM/);
    expect(reason({ summaryStatus: "no_previous" })).toMatch(/First snapshot/);
    expect(reason({ summaryStatus: "poll_failed" })).toMatch(/poll failed/);
  });
  it("is specific about not-listed competitors", () => {
    expect(reason({ status: "not_found", summaryStatus: "not_needed" })).toBe("Still not listed at the source.");
    expect(reason({ status: "not_found", summaryStatus: "no_previous" })).toMatch(/does not know this id/);
  });
});

describe("DTO mapping", () => {
  it("serialises dates to ISO and defaults missing collections", () => {
    const dto = toSnapshotDto(base);
    expect(dto.fetchedAt).toBe("2026-11-12T10:00:00.000Z");
    expect(dto.changes).toEqual([]);
    expect(dto.summaryReason).toBeTypeOf("string");
  });
  it("computes changedInLast24h from lastChangedAt", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const row = { id: "a", createdAt: now, removedAt: null, nextPollAt: now, lastPolledAt: null, lastStatus: null, lastChangedAt: new Date("2026-11-11T13:00:00Z"), unchangedStreak: 3 };
    expect(toCompetitorDto(row, 120, now).changedInLast24h).toBe(true);
    expect(toCompetitorDto({ ...row, lastChangedAt: new Date("2026-11-11T11:00:00Z") }, 120, now).changedInLast24h).toBe(false);
    expect(toCompetitorDto(row, 120, now)).toMatchObject({ intervalSeconds: 120, unchangedStreak: 3 });
  });
});
