import { QueryClient } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLiveUpdates } from "./live";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, (e: MessageEvent<string>) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

describe("useLiveUpdates", () => {
  it("subscribes once, reports connection state, and invalidates only what an event touches", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    const { result, unmount } = renderHook(() => useLiveUpdates(), { wrapper });
    expect(result.current).toBe("connecting");
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("/api/events");

    act(() => source.onopen?.());
    expect(result.current).toBe("live");

    invalidate.mockClear();
    act(() => source.emit("snapshot.recorded", { type: "snapshot.recorded", competitorId: "acme", snapshotId: 1, changed: true }));
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["competitors"]);
    expect(keys).toContainEqual(["snapshots", "acme"]);
    expect(keys).toContainEqual(["status"]);

    invalidate.mockClear();
    act(() => source.emit("summary.updated", { type: "summary.updated", competitorId: "acme", snapshotId: 1, status: "ok" }));
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).not.toContainEqual(["competitors"]);

    act(() => source.onerror?.());
    expect(result.current).toBe("reconnecting");

    unmount();
    expect(source.closed).toBe(true);
  });
});
