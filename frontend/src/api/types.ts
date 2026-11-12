/** Mirrors backend/src/http/dto.ts. */

export type SnapshotStatus = "ok" | "partial" | "not_found" | "error";

export type SummaryStatus =
  | "ok"
  | "pending"
  | "failed"
  | "unusable"
  | "cap_reached"
  | "disabled"
  | "not_needed"
  | "no_previous"
  | "poll_failed";

export type Competitor = {
  id: string;
  createdAt: string;
  lastPolledAt: string | null;
  lastStatus: SnapshotStatus | null;
  lastChangedAt: string | null;
  changedInLast24h: boolean;
  nextPollAt: string;
  intervalSeconds: number;
  unchangedStreak: number;
};

export type FieldChange = { field: string; before: string | null; after: string | null };

export type Snapshot = {
  id: number;
  fetchedAt: string;
  status: SnapshotStatus;
  title: string | null;
  tagline: string | null;
  price: string | null;
  description: string | null;
  missingFields: string[];
  error: string | null;
  changed: boolean;
  changes: FieldChange[];
  summary: string | null;
  summaryStatus: SummaryStatus;
  summaryReason: string;
  summarySource: "llm" | "rule" | null;
};

export type SystemStatus = {
  scheduler: { running: boolean; inFlight: number; polls: number; rateLimitedUntil: string | null } | null;
  sseClients: number;
  llm: {
    enabled: boolean;
    model: string | null;
    dailyCap: number;
    callsToday: number;
    paceHourly: boolean;
    allowedSoFarToday: number;
  };
  config: { pollIntervalSeconds: number; pollMaxIntervalSeconds: number; pollBackoffEvery: number; sourceBaseUrl: string };
};

export type DomainEvent =
  | { type: "competitor.added"; competitorId: string }
  | { type: "competitor.removed"; competitorId: string }
  | { type: "snapshot.recorded"; competitorId: string; snapshotId: number; changed: boolean }
  | { type: "summary.updated"; competitorId: string; snapshotId: number; status: SummaryStatus };
