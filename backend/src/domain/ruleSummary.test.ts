import { describe, expect, it } from "vitest";
import { normalizeListing } from "../source/normalize.js";
import { compareListings } from "./diff.js";
import { priceOnlySummary } from "./ruleSummary.js";

const base = { title: "Acme", tagline: "t", price: "$39/mo", description: "d" };
const run = (after: Record<string, unknown>) => {
  const a = normalizeListing(base);
  const b = normalizeListing({ ...base, ...after });
  return priceOnlySummary(compareListings(a, b), a, b);
};

describe("priceOnlySummary", () => {
  it("describes a drop with the percentage", () => {
    expect(run({ price: "USD 29 per month" })).toBe("Price dropped from $39/mo to $29/mo (26%).");
  });
  it("describes a rise", () => {
    expect(run({ price: "$49.00/mo" })).toBe("Price rose from $39/mo to $49/mo (26%).");
  });
  it("handles becoming free and a change of billing period", () => {
    expect(run({ price: "Free" })).toBe("The listing is now free (was $39/mo).");
    expect(run({ price: "$390/yr" })).toBe("Price changed from $39/mo to $390/yr.");
  });
  it("declines when anything else changed too", () => {
    expect(run({ price: "$29/mo", tagline: "new" })).toBeNull();
    expect(run({ tagline: "new" })).toBeNull();
  });
});
