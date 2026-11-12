import { describe, expect, it } from "vitest";
import { buildSummaryMessages } from "./prompt.js";

describe("buildSummaryMessages", () => {
  it("lists every change with before and after and marks missing values", () => {
    const [system, user] = buildSummaryMessages({
      competitorId: "acme-crm",
      fetchedAt: new Date("2026-11-12T10:00:00Z"),
      changes: [
        { field: "price", before: "$39/mo", after: "$29/mo" },
        { field: "tagline", before: null, after: "New" },
      ],
    });
    expect(system?.role).toBe("system");
    expect(user?.content).toContain("Competitor: acme-crm");
    expect(user?.content).toContain('- price: "$39/mo" -> "$29/mo"');
    expect(user?.content).toContain('- tagline: (not provided) -> "New"');
  });
});
