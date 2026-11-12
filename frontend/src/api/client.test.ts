import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("request", () => {
  it("sends JSON only when there is a body and parses the answer", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: "a" }), { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(request("/api/competitors", { method: "POST", body: { id: "a" } })).resolves.toEqual({ id: "a" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe('{"id":"a"}');

    await request("/api/competitors/a/poll", { method: "POST" });
    const [, bodiless] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((bodiless.headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(bodiless.body).toBeUndefined();
  });

  it("returns undefined for 204 and throws ApiError with the server's message otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
    await expect(request("/x", { method: "DELETE" })).resolves.toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "already tracked" }), { status: 409 }))));
    await expect(request("/x")).rejects.toMatchObject({ status: 409, message: "already tracked" });

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<html>", { status: 502 }))));
    const err = await request("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("HTTP 502");
  });
});
