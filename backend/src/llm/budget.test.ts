import { describe, expect, it } from "vitest";
import { nextHourStart, pacedAllowance } from "./budget.js";

describe("pacedAllowance", () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 10, 12, hour, 30));
  it("releases the cap linearly through the UTC day", () => {
    expect(pacedAllowance(2400, at(0))).toBe(100);
    expect(pacedAllowance(2400, at(11))).toBe(1200);
    expect(pacedAllowance(2400, at(23))).toBe(2400);
  });
  it("rounds up so small caps are usable from the first hour", () => {
    expect(pacedAllowance(10, at(0))).toBe(1);
    expect(pacedAllowance(10, at(23))).toBe(10);
  });
});

describe("nextHourStart", () => {
  it("returns the top of the next UTC hour", () => {
    expect(nextHourStart(new Date(Date.UTC(2026, 10, 12, 9, 17, 5))).toISOString()).toBe("2026-11-12T10:00:00.000Z");
    expect(nextHourStart(new Date(Date.UTC(2026, 10, 12, 23, 59))).toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });
});
