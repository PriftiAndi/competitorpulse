import { describe, expect, it, vi } from "vitest";
import { createLlmClient } from "./client.js";

function withReply(status: number, body: unknown, opts: { throws?: Error } = {}) {
  const fetchImpl = vi.fn(async () => {
    if (opts.throws) throw opts.throws;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
  return {
    fetchImpl,
    client: createLlmClient({ baseUrl: "https://llm.example/v1/", apiKey: "k", model: "m", timeoutMs: 500, fetchImpl: fetchImpl as unknown as typeof fetch }),
  };
}

const completion = (content: unknown, model = "served-model") => ({ model, choices: [{ message: { role: "assistant", content } }] });

describe("llm client", () => {
  it("posts an OpenAI-shaped request with the bearer token", async () => {
    const { client, fetchImpl } = withReply(200, completion("Price dropped."));
    const out = await client.complete([{ role: "user", content: "hi" }]);
    expect(out).toEqual({ kind: "ok", content: "Price dropped.", model: "served-model" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", messages: [{ role: "user", content: "hi" }] });
  });

  it("flags empty, missing, oversized and non-JSON answers as unusable", async () => {
    expect((await withReply(200, completion("   ")).client.complete([])).kind).toBe("unusable");
    expect((await withReply(200, { choices: [] }).client.complete([])).kind).toBe("unusable");
    expect((await withReply(200, completion("x".repeat(1001))).client.complete([])).kind).toBe("unusable");
    expect((await withReply(200, "not json").client.complete([])).kind).toBe("unusable");
  });

  it("classifies 4xx as non-retryable and 5xx/429 as retryable", async () => {
    expect(await withReply(404, { error: "model_not_found" }).client.complete([])).toMatchObject({ kind: "error", retryable: false });
    expect(await withReply(401, "").client.complete([])).toMatchObject({ kind: "error", retryable: false });
    expect(await withReply(429, "").client.complete([])).toMatchObject({ kind: "error", retryable: true });
    expect(await withReply(500, "").client.complete([])).toMatchObject({ kind: "error", retryable: true });
  });

  it("treats timeouts and network failures as retryable", async () => {
    const timeout = Object.assign(new Error("x"), { name: "TimeoutError" });
    expect(await withReply(0, "", { throws: timeout }).client.complete([])).toEqual({ kind: "error", message: "timeout after 500ms", retryable: true });
    expect(await withReply(0, "", { throws: new TypeError("fetch failed") }).client.complete([])).toMatchObject({ kind: "error", retryable: true });
  });
});
