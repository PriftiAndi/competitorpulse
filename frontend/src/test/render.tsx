import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/** Renders with a fresh, retry-free query client and an in-memory router. */
export function renderWithProviders(ui: ReactElement, opts: { route?: string } & RenderOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } } });
  const { route = "/", ...rest } = opts;
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
      rest,
    ),
  };
}

/** Builds a fetch stub that answers by method+path and records calls. */
export function fakeFetch(routes: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : new URL(input.url).pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const handler = routes[`${method} ${path}`] ?? routes[`${method} ${path.split("?")[0]}`];
    if (!handler) return Promise.resolve(new Response(JSON.stringify({ error: `no stub for ${method} ${path}` }), { status: 500 }));
    const { status = 200, body } = handler(init);
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body ?? null), { status, headers: { "content-type": "application/json" } }),
    );
  };
  return { impl, calls };
}
