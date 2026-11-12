import type { Snapshot } from "@/api/types";

export type TimelineItem =
  | { kind: "snapshot"; snapshot: Snapshot }
  /** Consecutive unchanged polls with the same status, hidden behind the newest one of the run. */
  | { kind: "run"; key: number; snapshots: Snapshot[] };

const MIN_RUN = 3;

/** Only boring polls collapse: unchanged, succeeded, and not the first observation. */
function isCollapsible(s: Snapshot): boolean {
  return !s.changed && s.status !== "error" && s.summaryStatus === "not_needed";
}

/**
 * Collapses runs of identical unchanged polls so the timeline shows what
 * happened, not how often nothing happened. The newest poll of a run stays
 * visible so the current state is always on screen. Input is newest first.
 */
export function groupSnapshots(snapshots: Snapshot[], minRun = MIN_RUN): TimelineItem[] {
  const items: TimelineItem[] = [];
  let i = 0;
  while (i < snapshots.length) {
    const head = snapshots[i]!;
    if (!isCollapsible(head)) {
      items.push({ kind: "snapshot", snapshot: head });
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < snapshots.length && isCollapsible(snapshots[j]!) && snapshots[j]!.status === head.status) j += 1;
    const run = snapshots.slice(i, j);
    if (run.length < minRun) {
      for (const s of run) items.push({ kind: "snapshot", snapshot: s });
    } else {
      items.push({ kind: "snapshot", snapshot: head });
      items.push({ kind: "run", key: run[1]!.id, snapshots: run.slice(1) });
    }
    i = j;
  }
  return items;
}
