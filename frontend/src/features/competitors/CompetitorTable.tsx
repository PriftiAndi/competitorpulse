import { useState } from "react";
import { useRemoveCompetitor } from "@/api/queries";
import type { Competitor } from "@/api/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CompetitorRow } from "@/features/competitors/CompetitorRow";

export function CompetitorTable({ competitors }: { competitors: Competitor[] }) {
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const remove = useRemoveCompetitor();

  function confirmRemoval() {
    if (pendingRemoval === null) return;
    remove.mutate(pendingRemoval, { onSuccess: () => setPendingRemoval(null) });
  }

  function cancelRemoval() {
    setPendingRemoval(null);
    remove.reset();
  }

  return (
    <section className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Competitor</th>
              <th>Last 24h</th>
              <th>Last poll</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {competitors.map((c) => (
              <CompetitorRow key={c.id} competitor={c} onRemove={setPendingRemoval} />
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={`Stop tracking ${pendingRemoval ?? ""}?`}
        confirmLabel="Stop tracking"
        danger
        busy={remove.isPending}
        error={remove.error?.message ?? null}
        onConfirm={confirmRemoval}
        onCancel={cancelRemoval}
      >
        Polling stops immediately. The history is kept and comes back if you add <code>{pendingRemoval}</code> again.
      </ConfirmDialog>
    </section>
  );
}
