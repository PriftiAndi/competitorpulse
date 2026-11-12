import { normalizeListing, type NormalizedListing } from "./normalize.js";

/** The outcome of one poll of the listing source, after retries. */
export type FetchOutcome =
  | { kind: "listing"; listing: NormalizedListing }
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "error"; message: string };

export type SourceClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type SourceClient = {
  fetchListing(id: string): Promise<FetchOutcome>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * HTTP client for the listing source. It treats the source as an unreliable
 * third-party website: hard timeout per request, one retry for transient
 * failures (5xx, network, timeout), and no retry for 404 or 429 (those are
 * decisions for the scheduler, not the client).
 */
export function createSourceClient(opts: SourceClientOptions): SourceClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function attempt(id: string): Promise<FetchOutcome> {
    const url = `${base}/listings/${encodeURIComponent(id)}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: { accept: "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error && err.name === "TimeoutError"
        ? `timeout after ${opts.timeoutMs}ms`
        : `network error: ${errorMessage(err)}`;
      return { kind: "error", message };
    }

    if (res.status === 404) {
      await res.text().catch(() => undefined);
      return { kind: "not_found" };
    }
    if (res.status === 429) {
      await res.text().catch(() => undefined);
      const header = Number(res.headers.get("retry-after"));
      const retryAfterSeconds = Number.isFinite(header) && header > 0 ? header : 1;
      return { kind: "rate_limited", retryAfterSeconds };
    }
    if (!res.ok) {
      await res.text().catch(() => undefined);
      return { kind: "error", message: `HTTP ${res.status}` };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: "error", message: "HTTP 200 with a body that is not JSON" };
    }
    return { kind: "listing", listing: normalizeListing(body) };
  }

  return {
    async fetchListing(id) {
      let last: FetchOutcome = { kind: "error", message: "no attempt made" };
      for (let n = 1; n <= opts.maxAttempts; n += 1) {
        last = await attempt(id);
        if (last.kind !== "error") return last;
        if (n < opts.maxAttempts) await sleep(250 * n);
      }
      return last;
    },
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
  }
  return String(err);
}
