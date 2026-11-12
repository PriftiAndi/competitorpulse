import { describe, expect, it } from "vitest";
import { summaryTone } from "./status";

describe("summaryTone", () => {
  it("maps every summary status to a presentation tone", () => {
    expect(summaryTone("ok", "llm")).toBe("llm");
    expect(summaryTone("ok", "rule")).toBe("rule");
    expect(summaryTone("pending", null)).toBe("pending");
    for (const s of ["failed", "unusable", "cap_reached"] as const) expect(summaryTone(s, null)).toBe("warn");
    for (const s of ["disabled", "not_needed", "no_previous", "poll_failed"] as const) expect(summaryTone(s, null)).toBe("muted");
  });
});
