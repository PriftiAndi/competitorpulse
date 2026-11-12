import { memo } from "react";
import { Link } from "react-router-dom";
import type { Competitor } from "@/api/types";
import { Pill } from "@/components/Pill";
import { Spinner } from "@/components/Spinner";
import { formatInterval, timeAgo } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";

type Props = { competitor: Competitor; onRemove: (id: string) => void };

/** Memoised: on a refetch only rows whose data changed re-render. */
export const CompetitorRow = memo(function CompetitorRow({ competitor: c, onRemove }: Props) {
  return (
    <tr>
      <td className="id">
        <Link to={`/competitors/${encodeURIComponent(c.id)}`}>{c.id}</Link>
      </td>
      <td>
        {c.changedInLast24h && c.lastChangedAt ? (
          <Pill tone="changed" title={c.lastChangedAt}>
            <span className="dot current" />
            Changed {timeAgo(c.lastChangedAt)}
          </Pill>
        ) : (
          <Pill tone="neutral">No change</Pill>
        )}
      </td>
      <td className="subtle" title={c.lastPolledAt ?? undefined}>
        {c.lastPolledAt ? timeAgo(c.lastPolledAt) : "queued"}
        <div className="faint small" title={`${c.unchangedStreak} unchanged polls in a row; the interval grows while nothing changes`}>
          every {formatInterval(c.intervalSeconds)}
        </div>
      </td>
      <td>
        {c.lastStatus ? (
          <Pill tone={c.lastStatus}>{STATUS_LABEL[c.lastStatus]}</Pill>
        ) : (
          <Pill tone="neutral">
            <Spinner /> first poll
          </Pill>
        )}
      </td>
      <td className="actions">
        <button type="button" className="btn ghost sm" onClick={() => onRemove(c.id)} aria-label={`Remove ${c.id}`}>
          Remove
        </button>
      </td>
    </tr>
  );
});
