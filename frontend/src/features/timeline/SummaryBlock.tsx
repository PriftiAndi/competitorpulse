import type { Snapshot } from "@/api/types";
import { SparkIcon, WarnIcon } from "@/components/icons";
import { Spinner } from "@/components/Spinner";
import { summaryTone } from "@/lib/status";

export function SummaryBlock({ snapshot: s }: { snapshot: Snapshot }) {
  const tone = summaryTone(s.summaryStatus, s.summarySource);

  switch (tone) {
    case "llm":
    case "rule":
      return (
        <div className={`summary ${tone}`}>
          <SparkIcon />
          <div>
            <div className="label">{tone === "rule" ? "Summary · rule-based" : "Summary · LLM"}</div>
            <p>{s.summary}</p>
          </div>
        </div>
      );
    case "pending":
      return (
        <div className="summary pending">
          <Spinner className="summary-spinner" />
          <div>
            <div className="label">Summary</div>
            <p>{s.summaryReason}</p>
          </div>
        </div>
      );
    case "warn":
      return (
        <div className="summary warn">
          <WarnIcon />
          <div>
            <div className="label">No summary</div>
            <p>{s.summaryReason}</p>
          </div>
        </div>
      );
    case "muted":
      return (
        <div className="summary muted">
          <p>{s.summaryReason}</p>
        </div>
      );
  }
}
