import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { usePollNow, useSnapshots } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState";
import { Pill } from "@/components/Pill";
import { Spinner } from "@/components/Spinner";
import { CollapsedRun } from "@/features/timeline/CollapsedRun";
import { groupSnapshots } from "@/features/timeline/groupSnapshots";
import { SnapshotCard } from "@/features/timeline/SnapshotCard";
import { plural } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";

export default function TimelinePage() {
  const { id = "" } = useParams();
  const { data, error, isPending } = useSnapshots(id);
  const pollNow = usePollNow();

  const changes = useMemo(() => data?.filter((s) => s.changed).length ?? 0, [data]);
  const items = useMemo(() => (data ? groupSnapshots(data) : []), [data]);
  const latest = data?.[0];
  const notTracked = error instanceof ApiError && error.status === 404;

  return (
    <div className="stack">
      <p className="no-margin">
        <Link to="/">← All competitors</Link>
      </p>
      <div className="page-head">
        <h2 className="mono">{id}</h2>
        {latest && <Pill tone={latest.status}>{STATUS_LABEL[latest.status]}</Pill>}
        {data && (
          <span className="faint">
            {plural(data.length, "snapshot")} · {plural(changes, "change")}
          </span>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => pollNow.mutate(id)} disabled={pollNow.isPending || notTracked}>
          {pollNow.isPending ? <Spinner /> : "↻"} Poll now
        </button>
      </div>

      {notTracked && (
        <EmptyState title="This competitor is not tracked">
          <Link to="/">Back to the list</Link>
        </EmptyState>
      )}
      {error && !notTracked && <p className="form-error">Could not load snapshots: {error.message}</p>}
      {isPending && <EmptyState title="Loading…" />}
      {data && data.length === 0 && (
        <EmptyState title="No snapshots yet">The first poll runs within a few seconds of adding a competitor.</EmptyState>
      )}
      {data && data.length > 0 && (
        <ol className="timeline">
          {items.map((item) =>
            item.kind === "run" ? (
              <CollapsedRun key={`run-${item.key}`} snapshots={item.snapshots} />
            ) : (
              <li key={item.snapshot.id}>
                <span className={`marker ${item.snapshot.changed ? "changed" : item.snapshot.status}`} aria-hidden="true" />
                <SnapshotCard snapshot={item.snapshot} />
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}
