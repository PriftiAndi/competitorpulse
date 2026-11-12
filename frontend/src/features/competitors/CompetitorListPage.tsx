import { useMemo } from "react";
import { useCompetitors } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState";
import { AddCompetitorForm } from "@/features/competitors/AddCompetitorForm";
import { CompetitorStats } from "@/features/competitors/CompetitorStats";
import { CompetitorTable } from "@/features/competitors/CompetitorTable";

export default function CompetitorListPage() {
  const { data, error, isPending } = useCompetitors();

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      total: data.length,
      changed: data.filter((c) => c.changedInLast24h).length,
      unavailable: data.filter((c) => c.lastStatus === "not_found" || c.lastStatus === "error").length,
    };
  }, [data]);

  return (
    <div className="stack">
      <div className="page-head">
        <h2>Tracked competitors</h2>
      </div>

      <AddCompetitorForm />

      {stats && stats.total > 0 && <CompetitorStats {...stats} />}

      {error && <p className="form-error">Could not load competitors: {error.message}</p>}
      {isPending && <EmptyState title="Loading…" />}
      {data && data.length === 0 && (
        <EmptyState title="No competitors tracked yet">
          Add an id above to start polling. Try <code>acme-crm</code> or <code>ferry-pay</code>.
        </EmptyState>
      )}
      {data && data.length > 0 && <CompetitorTable competitors={data} />}
    </div>
  );
}
