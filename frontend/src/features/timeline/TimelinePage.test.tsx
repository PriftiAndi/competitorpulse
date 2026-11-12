import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import type { Snapshot } from "@/api/types";
import { fakeFetch, renderWithProviders } from "@/test/render";
import TimelinePage from "./TimelinePage";

let nextId = 1000;
const snap = (over: Partial<Snapshot>): Snapshot => {
  nextId -= 1;
  return {
    id: nextId,
    fetchedAt: new Date(Date.UTC(2026, 10, 12, 12, 0, nextId % 60)).toISOString(),
    status: "ok",
    title: "Acme CRM",
    tagline: "Simple CRM",
    price: "$29/mo",
    description: "Track leads.",
    missingFields: [],
    error: null,
    changed: false,
    changes: [],
    summary: null,
    summaryStatus: "not_needed",
    summaryReason: "Nothing that matters changed since the previous snapshot.",
    summarySource: null,
    ...over,
  };
};

const page = (route = "/competitors/acme-crm") =>
  renderWithProviders(
    <Routes>
      <Route path="/competitors/:id" element={<TimelinePage />} />
    </Routes>,
    { route },
  );

afterEach(() => vi.unstubAllGlobals());

describe("TimelinePage", () => {
  it("renders snapshots newest first with fields, diffs and every summary state", async () => {
    const snapshots = [
      snap({ changed: true, changes: [{ field: "price", before: "$39/mo", after: "$29/mo" }], summary: "Price dropped from $39/mo to $29/mo (26%).", summaryStatus: "ok", summarySource: "rule" }),
      snap({ changed: true, changes: [{ field: "tagline", before: "a", after: "b" }], summaryStatus: "pending", summaryReason: "A change was detected; the summary is being generated." }),
      snap({ changed: true, changes: [{ field: "tagline", before: "b", after: "c" }], summaryStatus: "failed", summaryReason: "The LLM call failed after 3 attempt(s): timeout" }),
      snap({ status: "partial", missingFields: ["description"] }),
      snap({ status: "error", error: "HTTP 502", summaryStatus: "poll_failed", summaryReason: "The poll failed, so there is no listing to compare." }),
      snap({ status: "not_found", title: null, price: null, summaryReason: "Still not listed at the source." }),
      snap({ summaryStatus: "no_previous", summaryReason: "First snapshot of this competitor; nothing to compare with." }),
    ];
    const { impl } = fakeFetch({ "GET /api/competitors/acme-crm/snapshots": () => ({ body: snapshots }) });
    vi.stubGlobal("fetch", impl);
    page();

    expect(await screen.findByText("7 snapshots · 3 changes")).toBeInTheDocument();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(7);

    const first = within(cards[0]!);
    expect(first.getByText("Changed")).toBeInTheDocument();
    expect(first.getByText("$39/mo")).toBeInTheDocument();
    expect(first.getByText("Summary · rule-based")).toBeInTheDocument();
    expect(first.getByText(/Price dropped/)).toBeInTheDocument();

    expect(within(cards[1]!).getByText(/being generated/)).toBeInTheDocument();
    expect(within(cards[2]!).getByText("No summary")).toBeInTheDocument();
    expect(within(cards[2]!).getByText(/failed after 3 attempt/)).toBeInTheDocument();
    expect(within(cards[3]!).getByText(/showing last known value/)).toBeInTheDocument();
    expect(within(cards[4]!).getByText("HTTP 502")).toBeInTheDocument();
    expect(within(cards[4]!).queryByText("Title")).not.toBeInTheDocument();
    expect(within(cards[5]!).getByText("Still not listed at the source.")).toBeInTheDocument();
    expect(within(cards[6]!).getByText(/First snapshot/)).toBeInTheDocument();
  });

  it("collapses long runs of unchanged polls and expands them on demand", async () => {
    const user = userEvent.setup();
    const snapshots = [snap({}), snap({}), snap({}), snap({}), snap({}), snap({ summaryStatus: "no_previous" })];
    const { impl } = fakeFetch({ "GET /api/competitors/acme-crm/snapshots": () => ({ body: snapshots }) });
    vi.stubGlobal("fetch", impl);
    page();

    expect(await screen.findByText("4 more polls")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getAllByRole("article")).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: /Hide 4 unchanged polls/ }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("explains an untracked competitor and disables polling", async () => {
    const { impl } = fakeFetch({ "GET /api/competitors/ghost/snapshots": () => ({ status: 404, body: { error: "competitor not found" } }) });
    vi.stubGlobal("fetch", impl);
    page("/competitors/ghost");
    expect(await screen.findByText("This competitor is not tracked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Poll now/ })).toBeDisabled();
  });

  it("requests an immediate poll", async () => {
    const user = userEvent.setup();
    const { impl, calls } = fakeFetch({
      "GET /api/competitors/acme-crm/snapshots": () => ({ body: [] }),
      "POST /api/competitors/acme-crm/poll": () => ({ status: 202, body: { ok: true } }),
    });
    vi.stubGlobal("fetch", impl);
    page();
    expect(await screen.findByText("No snapshots yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Poll now/ }));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/competitors/acme-crm/poll")).toBe(true);
  });
});
