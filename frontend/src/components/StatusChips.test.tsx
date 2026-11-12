import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemStatus } from "@/api/types";
import { fakeFetch, renderWithProviders } from "@/test/render";
import { StatusChips } from "./StatusChips";

const status = (over: Partial<SystemStatus["llm"]> = {}, rateLimitedUntil: string | null = null): SystemStatus => ({
  scheduler: { running: true, inFlight: 0, polls: 10, rateLimitedUntil },
  sseClients: 1,
  llm: { enabled: true, model: "gpt-x", dailyCap: 2000, callsToday: 12, paceHourly: true, allowedSoFarToday: 1500, ...over },
  config: { pollIntervalSeconds: 60, pollMaxIntervalSeconds: 240, pollBackoffEvery: 10, sourceBaseUrl: "http://s" },
});

afterEach(() => vi.unstubAllGlobals());

describe("StatusChips", () => {
  it("shows connection state, polling, LLM usage and pacing", async () => {
    vi.stubGlobal("fetch", fakeFetch({ "GET /api/status": () => ({ body: status() }) }).impl);
    renderWithProviders(<StatusChips live="live" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(await screen.findByText("gpt-x")).toBeInTheDocument();
    expect(screen.getByText(/12\/2000 today/)).toBeInTheDocument();
    expect(screen.getByText(/1500 released/)).toBeInTheDocument();
    expect(screen.getByText(/to 240s/)).toBeInTheDocument();
  });

  it("warns when the source rate limit paused polling and shows a disabled LLM", async () => {
    vi.stubGlobal("fetch", fakeFetch({ "GET /api/status": () => ({ body: status({ enabled: false, model: null }, "2026-11-12T12:00:00Z") }) }).impl);
    renderWithProviders(<StatusChips live="reconnecting" />);
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
    expect(await screen.findByText(/Rate limited until/)).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });
});
