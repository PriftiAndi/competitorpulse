import { describe, expect, it } from "vitest";
import { intervalForStreak } from "./interval.js";

const cfg = { POLL_INTERVAL_SECONDS: 900, POLL_MAX_INTERVAL_SECONDS: 3600, POLL_BACKOFF_EVERY: 10 };

describe("intervalForStreak", () => {
  it("starts at the base interval and doubles every N unchanged polls", () => {
    expect(intervalForStreak(0, cfg)).toBe(900);
    expect(intervalForStreak(9, cfg)).toBe(900);
    expect(intervalForStreak(10, cfg)).toBe(1800);
    expect(intervalForStreak(20, cfg)).toBe(3600);
  });
  it("never exceeds the maximum", () => {
    expect(intervalForStreak(1000, cfg)).toBe(3600);
  });
});
