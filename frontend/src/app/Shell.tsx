import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { useLiveUpdates } from "@/api/live";
import { AppBar } from "@/components/AppBar";
import { EmptyState } from "@/components/EmptyState";

/** Page chrome shared by every route. Owns the single SSE subscription. */
export function Shell() {
  const live = useLiveUpdates();
  return (
    <>
      <AppBar live={live} />
      <main>
        <Suspense fallback={<EmptyState title="Loading…" />}>
          <Outlet />
        </Suspense>
      </main>
    </>
  );
}
