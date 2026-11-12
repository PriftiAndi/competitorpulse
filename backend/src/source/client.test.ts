import { describe, expect, it, vi } from "vitest";
import { createSourceClient } from "./client.js";

type Reply = { status: number; body?: string; headers?: Record<string, string>; throws?: Error };

function fetchSequence(replies: Reply[]) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    const reply = replies.shift();
    if (!reply) throw new Error("no more replies");
    if (reply.throws) throw reply.throws;
    return new Response(reply.body ?? "", { status: reply.status, headers: reply.headers });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const client = (replies: Reply[], maxAttempts = 2) => {
  const seq = fetchSequence(replies);
  return {
    ...seq,
    client: createSourceClient({ baseUrl: "http://source:4002/", timeoutMs: 1000, maxAttempts, fetchImpl: seq.fetchImpl, sleep: async () => {} }),
  };
};

describe("source client", () => {
  it("builds the url, encodes the id and normalises the listing", async () => {
    const { client: c, calls } = client([{ status: 200, body: JSON.stringify({ title: " Acme ", price: "$29/mo", noise: 1 }) }]);
    const out = await c.fetchListing("acme crm");
    expect(calls).toEqual(["http://source:4002/listings/acme%20crm"]);
    expect(out).toMatchObject({ kind: "listing", listing: { title: "Acme", price: "$29/mo" } });
  });

  it("maps 404 to not_found without retrying", async () => {
    const { client: c, calls } = client([{ status: 404, body: "{}" }, { status: 200 }]);
    expect(await c.fetchListing("x")).toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(1);
  });

  it("maps 429 with Retry-After and never retries it", async () => {
    const { client: c, calls } = client([{ status: 429, headers: { "retry-after": "7" } }]);
    expect(await c.fetchListing("x")).toEqual({ kind: "rate_limited", retryAfterSeconds: 7 });
    expect(calls).toHaveLength(1);
  });

  it("defaults Retry-After to 1s when the header is missing or invalid", async () => {
    const { client: c } = client([{ status: 429, headers: { "retry-after": "soon" } }]);
    expect(await c.fetchListing("x")).toEqual({ kind: "rate_limited", retryAfterSeconds: 1 });
  });

  it("retries a 5xx once and succeeds", async () => {
    const { client: c, calls } = client([{ status: 502, body: "<html>" }, { status: 200, body: JSON.stringify({ title: "A" }) }]);
    expect((await c.fetchListing("x")).kind).toBe("listing");
    expect(calls).toHaveLength(2);
  });

  it("gives up after maxAttempts with the last error", async () => {
    const { client: c, calls } = client([{ status: 500 }, { status: 503 }], 2);
    expect(await c.fetchListing("x")).toEqual({ kind: "error", message: "HTTP 503" });
    expect(calls).toHaveLength(2);
  });

  it("reports timeouts and network errors as retryable errors", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const { client: c } = client([{ status: 0, throws: timeout }, { status: 0, throws: new TypeError("fetch failed") }]);
    expect(await c.fetchListing("x")).toEqual({ kind: "error", message: "network error: fetch failed" });
  });

  it("treats a 200 with a non-JSON body as an error", async () => {
    const { client: c } = client([{ status: 200, body: "<html>oops" }], 1);
    expect(await c.fetchListing("x")).toEqual({ kind: "error", message: "HTTP 200 with a body that is not JSON" });
  });
});
