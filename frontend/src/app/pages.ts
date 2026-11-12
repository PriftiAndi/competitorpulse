import { lazy } from "react";

/** Route-level code splitting: each page is its own chunk, loaded on first visit. */
export const CompetitorListPage = lazy(() => import("@/features/competitors/CompetitorListPage"));
export const TimelinePage = lazy(() => import("@/features/timeline/TimelinePage"));
