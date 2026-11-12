import type { SnapshotStatus, SummaryStatus } from "@/api/types";

export const STATUS_LABEL: Record<SnapshotStatus, string> = {
  ok: "Listed",
  partial: "Listed · incomplete response",
  not_found: "Not listed at the source",
  error: "Poll failed",
};

export type SummaryTone = "llm" | "rule" | "pending" | "warn" | "muted";

/** How the UI should present a summary state. */
export function summaryTone(status: SummaryStatus, source: "llm" | "rule" | null): SummaryTone {
  switch (status) {
    case "ok":
      return source === "rule" ? "rule" : "llm";
    case "pending":
      return "pending";
    case "failed":
    case "unusable":
    case "cap_reached":
      return "warn";
    case "disabled":
    case "not_needed":
    case "no_previous":
    case "poll_failed":
      return "muted";
  }
}
