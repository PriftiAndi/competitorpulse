/**
 * Minimal OpenAI Chat Completions client. Works with OpenAI, the provided mock
 * server, Ollama (/v1), and any other compatible provider. No SDK, so the
 * timeout and error handling are explicit and easy to reason about.
 */
export type ChatMessage = { role: "system" | "user"; content: string };

export type LlmResult =
  | { kind: "ok"; content: string; model: string }
  | { kind: "unusable"; message: string }
  /** retryable: transient (timeout, network, 5xx, 429). Non-retryable: client errors such as a bad key or model. */
  | { kind: "error"; message: string; retryable: boolean };

export type LlmClient = {
  readonly model: string;
  complete(messages: ChatMessage[]): Promise<LlmResult>;
};

export type LlmClientOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

const MAX_SUMMARY_CHARS = 1000;

export function createLlmClient(opts: LlmClientOptions): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    model: opts.model,
    async complete(messages) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          signal: AbortSignal.timeout(opts.timeoutMs),
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({ model: opts.model, messages, temperature: 0.2, max_tokens: 200 }),
        });
      } catch (err) {
        const message =
          err instanceof Error && err.name === "TimeoutError"
            ? `timeout after ${opts.timeoutMs}ms`
            : `network error: ${err instanceof Error ? err.message : String(err)}`;
        return { kind: "error", message, retryable: true };
      }

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
        return { kind: "error", message: `HTTP ${res.status}: ${text.slice(0, 200)}`, retryable };
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { kind: "unusable", message: "response body is not JSON" };
      }
      const content = extractContent(body);
      if (content === null) return { kind: "unusable", message: "response has no message content" };
      const trimmed = content.trim();
      if (trimmed === "") return { kind: "unusable", message: "model returned an empty summary" };
      if (trimmed.length > MAX_SUMMARY_CHARS) {
        return { kind: "unusable", message: `summary too long (${trimmed.length} chars)` };
      }
      return { kind: "ok", content: trimmed, model: extractModel(body) ?? opts.model };
    },
  };
}

function extractContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : null;
}

function extractModel(body: unknown): string | null {
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" ? model : null;
}
