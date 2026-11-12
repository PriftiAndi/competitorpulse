import { describe, expect, it } from "vitest";
import type { Snapshot } from "@/api/types";
import { groupSnapshots } from "./groupSnapshots";

let nextId = 100;
function snap(over: Partial<Snapshot>): Snapshot {
  nextId -= 1;
  return {
    id: nextId,
    fetchedAt: new Date(Date.UTC(2026, 10, 12, 12, nextId % 60)).toISOString(),
    status: "ok",
    title: "t",
    tagline: "g",
    price: "$1/mo",
    description: "d",
    missingFields: [],
    error: null,
    changed: false,
    changes: [],
    summary: null,
    summaryStatus: "not_needed",
    summaryReason: "",
    summarySource: null,
    ...over,
  };
}

describe("groupSnapshots", () => {
  it("collapses a long run of unchanged polls behind the newest one", () => {
    const list = [snap({}), snap({}), snap({}), snap({}), snap({ summaryStatus: "no_previous" })];
    const items = groupSnapshots(list);
    expect(items.map((i) => i.kind)).toEqual(["snapshot", "run", "snapshot"]);
    expect(items[1]).toMatchObject({ kind: "run", snapshots: expect.arrayContaining([]) as unknown });
    expect((items[1] as { snapshots: Snapshot[] }).snapshots).toHaveLength(3);
  });

  it("never collapses changes, errors or the first observation", () => {
    const list = [
      snap({}),
      snap({ changed: true, summaryStatus: "ok" }),
      snap({ status: "error", summaryStatus: "poll_failed" }),
      snap({}),
      snap({ summaryStatus: "no_previous" }),
    ];
    expect(groupSnapshots(list).every((i) => i.kind === "snapshot")).toBe(true);
  });

  it("does not merge runs with different statuses", () => {
    const list = [snap({ status: "not_found" }), snap({ status: "not_found" }), snap({ status: "not_found" }), snap({}), snap({}), snap({})];
    const items = groupSnapshots(list);
    expect(items.map((i) => i.kind)).toEqual(["snapshot", "run", "snapshot", "run"]);
  });

  it("leaves short runs expanded", () => {
    expect(groupSnapshots([snap({}), snap({})]).every((i) => i.kind === "snapshot")).toBe(true);
  });
});
