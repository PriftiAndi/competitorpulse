import { describe, expect, it } from "vitest";
import { formatInterval, plural, timeAgo } from "./format";

describe("timeAgo", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

  it("picks the coarsest useful unit", () => {
    expect(timeAgo(at(5), now)).toBe("5s ago");
    expect(timeAgo(at(90), now)).toBe("2m ago");
    expect(timeAgo(at(3 * 3600), now)).toBe("3h ago");
    expect(timeAgo(at(5 * 86400), now)).toBe("5d ago");
  });

  it("never goes negative for clock skew", () => {
    expect(timeAgo(at(-30), now)).toBe("0s ago");
  });
});

describe("plural", () => {
  it("handles one and many", () => {
    expect(plural(1, "change")).toBe("1 change");
    expect(plural(2, "change")).toBe("2 changes");
  });
});

describe("formatInterval", () => {
  it("uses the largest exact unit", () => {
    expect(formatInterval(45)).toBe("45s");
    expect(formatInterval(120)).toBe("2m");
    expect(formatInterval(3600)).toBe("1h");
    expect(formatInterval(2700)).toBe("45m");
  });
});
