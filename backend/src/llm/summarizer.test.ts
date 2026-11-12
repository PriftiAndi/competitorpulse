import { describe, expect, it } from "vitest";
import { backoffMs } from "./summarizer.js";

describe("backoffMs", () => {
  it("doubles from 5s and caps at 60s", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(10)).toBe(60_000);
  });
});
