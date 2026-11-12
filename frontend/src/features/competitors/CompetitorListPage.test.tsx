import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Competitor } from "@/api/types";
import { fakeFetch, renderWithProviders } from "@/test/render";
import CompetitorListPage from "./CompetitorListPage";

const competitor = (over: Partial<Competitor>): Competitor => ({
  id: "acme-crm",
  createdAt: new Date().toISOString(),
  lastPolledAt: new Date(Date.now() - 30_000).toISOString(),
  lastStatus: "ok",
  lastChangedAt: null,
  changedInLast24h: false,
  nextPollAt: new Date().toISOString(),
  intervalSeconds: 60,
  unchangedStreak: 2,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("CompetitorListPage", () => {
  it("shows the empty state, then lists competitors with change flags, status pills and intervals", async () => {
    let list: Competitor[] = [];
    const { impl } = fakeFetch({ "GET /api/competitors": () => ({ body: list }) });
    vi.stubGlobal("fetch", impl);
    const { client } = renderWithProviders(<CompetitorListPage />);
    expect(await screen.findByText(/No competitors tracked yet/)).toBeInTheDocument();

    list = [
      competitor({ id: "acme-crm", changedInLast24h: true, lastChangedAt: new Date(Date.now() - 120_000).toISOString() }),
      competitor({ id: "nope", lastStatus: "not_found", intervalSeconds: 240 }),
      competitor({ id: "fresh", lastStatus: null, lastPolledAt: null }),
    ];
    await client.invalidateQueries();

    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(4); // header + 3
    const acme = within(rows[1]!);
    expect(acme.getByRole("link", { name: "acme-crm" })).toHaveAttribute("href", "/competitors/acme-crm");
    expect(acme.getByText(/Changed 2m ago/)).toBeInTheDocument();
    expect(acme.getByText("Listed")).toBeInTheDocument();
    expect(acme.getByText("every 1m")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Not listed at the source")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("every 4m")).toBeInTheDocument();
    expect(within(rows[3]!).getByText(/first poll/)).toBeInTheDocument();
    expect(screen.getByText("Changed in last 24h").nextElementSibling).toHaveTextContent("1 / 3");
    expect(screen.getByText("Not listed / failing").nextElementSibling).toHaveTextContent("1");
  });

  it("adds a competitor, clears the input and refreshes the list", async () => {
    const user = userEvent.setup();
    let list: Competitor[] = [];
    const { impl, calls } = fakeFetch({
      "GET /api/competitors": () => ({ body: list }),
      "POST /api/competitors": (init) => {
        const { id } = JSON.parse(init?.body as string) as { id: string };
        list = [competitor({ id })];
        return { status: 201, body: list[0] };
      },
    });
    vi.stubGlobal("fetch", impl);
    renderWithProviders(<CompetitorListPage />);

    const input = await screen.findByLabelText("Competitor id");
    const button = screen.getByRole("button", { name: /Track competitor/ });
    expect(button).toBeDisabled();
    await user.type(input, "  orbit-hr ");
    expect(button).toBeEnabled();
    await user.click(button);

    expect(await screen.findByRole("link", { name: "orbit-hr" })).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ id: "orbit-hr" });
  });

  it("shows the server's error when adding fails", async () => {
    const user = userEvent.setup();
    const { impl } = fakeFetch({
      "GET /api/competitors": () => ({ body: [competitor({})] }),
      "POST /api/competitors": () => ({ status: 409, body: { error: "competitor 'acme-crm' is already tracked" } }),
    });
    vi.stubGlobal("fetch", impl);
    renderWithProviders(<CompetitorListPage />);
    await user.type(await screen.findByLabelText("Competitor id"), "acme-crm");
    await user.click(screen.getByRole("button", { name: /Track competitor/ }));
    expect(await screen.findByText("competitor 'acme-crm' is already tracked")).toBeInTheDocument();
  });

  it("asks for confirmation before removing and only deletes on confirm", async () => {
    const user = userEvent.setup();
    let list = [competitor({})];
    const { impl, calls } = fakeFetch({
      "GET /api/competitors": () => ({ body: list }),
      "DELETE /api/competitors/acme-crm": () => {
        list = [];
        return { status: 204 };
      },
    });
    vi.stubGlobal("fetch", impl);
    renderWithProviders(<CompetitorListPage />);

    await user.click(await screen.findByRole("button", { name: "Remove acme-crm" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Stop tracking acme-crm/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Remove acme-crm" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Stop tracking" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/competitors/acme-crm")).toBe(true));
    expect(await screen.findByText(/No competitors tracked yet/)).toBeInTheDocument();
  });
});
