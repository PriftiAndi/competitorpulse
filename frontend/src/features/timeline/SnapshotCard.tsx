import { memo } from "react";
import type { Snapshot } from "@/api/types";
import { Pill } from "@/components/Pill";
import { ChangeList } from "@/features/timeline/ChangeList";
import { SnapshotFields } from "@/features/timeline/SnapshotFields";
import { SummaryBlock } from "@/features/timeline/SummaryBlock";
import { formatTime, timeAgo } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";

/** Memoised: a refetch re-renders only snapshots whose data changed (e.g. a summary arriving). */
export const SnapshotCard = memo(function SnapshotCard({ snapshot: s }: { snapshot: Snapshot }) {
  const hasListing = s.status === "ok" || s.status === "partial";
  return (
    <article className={`card snapshot ${s.changed ? "changed" : ""}`}>
      <header className="snap-head">
        <time dateTime={s.fetchedAt}>{formatTime(s.fetchedAt)}</time>
        <span className="ago">{timeAgo(s.fetchedAt)}</span>
        <Pill tone={s.status}>{STATUS_LABEL[s.status]}</Pill>
        {s.changed ? <Pill tone="changed">Changed</Pill> : <Pill tone="neutral">Unchanged</Pill>}
      </header>
      <div className="snap-body">
        {s.status === "error" && <p className="poll-error">{s.error}</p>}
        {hasListing && <SnapshotFields snapshot={s} />}
        {s.changes.length > 0 && <ChangeList changes={s.changes} />}
        <SummaryBlock snapshot={s} />
      </div>
    </article>
  );
});
