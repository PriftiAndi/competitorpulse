import { describe, expect, it } from "vitest";
import { normalizeListing } from "../source/normalize.js";
import { diffObservation, type KnownState } from "./diff.js";

const base = {
  title: "Acme CRM",
  tagline: "Simple CRM for small teams",
  price: "$39/mo",
  description: "Track leads and deals in one place.",
};
const listed = (overrides: Record<string, unknown> = {}): KnownState => ({
  kind: "listed",
  listing: normalizeListing({ ...base, ...overrides }),
});

describe("diffObservation", () => {
  it("first observation is never a change", () => {
    const r = diffObservation(null, { kind: "listed", listing: normalizeListing(base) });
    expect(r.changed).toBe(false);
    expect(r.changes).toEqual([]);
  });

  it("ignores formatting noise", () => {
    const noisy = normalizeListing({
      ...base,
      title: "  Acme  CRM ",
      price: "USD 39.00 per month",
      description: "Track leads and deals in one&nbsp;place.",
      promoBanner: "x",
      viewerCount: 3,
    });
    const r = diffObservation(listed(), { kind: "listed", listing: noisy });
    expect(r.changed).toBe(false);
  });

  it("detects a price change by value", () => {
    const r = diffObservation(listed(), {
      kind: "listed",
      listing: normalizeListing({ ...base, price: "$29 / month" }),
    });
    expect(r.changed).toBe(true);
    expect(r.changes).toEqual([{ field: "price", before: "$39/mo", after: "$29/mo" }]);
  });

  it("carries missing fields forward instead of treating them as removed", () => {
    const partial = normalizeListing({ ...base, price: null });
    const r = diffObservation(listed(), { kind: "listed", listing: partial });
    expect(r.changed).toBe(false);
    expect(r.effective?.price).toBe("$39/mo");
    expect(r.effective?.missingFields).toEqual(["price"]);
  });

  it("treats delisting and relisting as changes that matter", () => {
    const gone = diffObservation(listed(), { kind: "delisted" });
    expect(gone.changed).toBe(true);
    expect(gone.changes[0]?.field).toBe("availability");

    const again = diffObservation(
      { kind: "delisted", lastListing: normalizeListing(base) },
      { kind: "listed", listing: normalizeListing({ ...base, price: "$59/mo" }) },
    );
    expect(again.changed).toBe(true);
    expect(again.changes.map((c) => c.field)).toEqual(["availability", "price"]);

    const stillGone = diffObservation({ kind: "delisted", lastListing: null }, { kind: "delisted" });
    expect(stillGone.changed).toBe(false);
  });
});
