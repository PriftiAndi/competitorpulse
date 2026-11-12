export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Json = Record<string, unknown> | unknown[] | null;

export async function request<T>(path: string, init?: Omit<RequestInit, "body"> & { body?: Json }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...(init?.body !== undefined && { "content-type": "application/json" }) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}
