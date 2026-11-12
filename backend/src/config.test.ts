import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults and derives the max poll interval", () => {
    const cfg = loadConfig({});
    expect(cfg.PORT).toBe(4000);
    expect(cfg.POLL_INTERVAL_SECONDS).toBe(60);
    expect(cfg.POLL_MAX_INTERVAL_SECONDS).toBe(240);
    expect(cfg.LLM_PACE_HOURLY).toBe(true);
    expect(cfg.SCHEDULER_ENABLED).toBe(true);
  });

  it("coerces and validates values", () => {
    const cfg = loadConfig({ POLL_INTERVAL_SECONDS: "900", POLL_MAX_INTERVAL_SECONDS: "3600", LLM_PACE_HOURLY: "false", LLM_BASE_URL: "" });
    expect(cfg.POLL_MAX_INTERVAL_SECONDS).toBe(3600);
    expect(cfg.LLM_PACE_HOURLY).toBe(false);
    expect(cfg.LLM_BASE_URL).toBe("");
  });

  it("rejects nonsense with a readable message", () => {
    expect(() => loadConfig({ SOURCE_MAX_RPS: "-1" })).toThrow(/SOURCE_MAX_RPS/);
    expect(() => loadConfig({ SOURCE_BASE_URL: "not a url" })).toThrow(/SOURCE_BASE_URL/);
    expect(() => loadConfig({ POLL_INTERVAL_SECONDS: "100", POLL_MAX_INTERVAL_SECONDS: "50" })).toThrow(/POLL_MAX_INTERVAL_SECONDS/);
  });
});
