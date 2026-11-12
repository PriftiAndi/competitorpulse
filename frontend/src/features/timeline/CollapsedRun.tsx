import { useState } from "react";
import type { Snapshot } from "@/api/types";
import { SnapshotCard } from "@/features/timeline/SnapshotCard";
import { formatTime, plural } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";

/** A run of identical unchanged polls, shown as one line until expanded. */
export function CollapsedRun({ snapshots }: { snapshots: Snapshot[] }) {
  const [expanded, setExpanded] = useState(false);
  const newest = snapshots[0]!;
  const oldest = snapshots[snapshots.length - 1]!;

  if (expanded) {
    return (
      <>
        <li className="run-toggle">
          <span className="marker muted-marker" aria-hidden="true" />
          <button type="button" className="btn ghost sm" onClick={() => setExpanded(false)}>
            Hide {plural(snapshots.length, "unchanged poll")}
          </button>
        </li>
        {snapshots.map((s) => (
          <li key={s.id}>
            <span className={`marker ${s.status}`} aria-hidden="true" />
            <SnapshotCard snapshot={s} />
          </li>
        ))}
      </>
    );
  }

  return (
    <li className="run-toggle">
      <span className="marker muted-marker" aria-hidden="true" />
      <div className="run">
        <span>
          <strong>{plural(snapshots.length, "more poll")}</strong> · {STATUS_LABEL[newest.status].toLowerCase()} · unchanged ·{" "}
          <span className="faint">
            {formatTime(oldest.fetchedAt)} to {formatTime(newest.fetchedAt)}
          </span>
        </span>
        <button type="button" className="btn ghost sm" onClick={() => setExpanded(true)}>
          Show
        </button>
      </div>
    </li>
  );
}
