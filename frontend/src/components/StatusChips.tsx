import type { LiveState } from "@/api/live";
import { useSystemStatus } from "@/api/queries";

const LIVE_LABEL: Record<LiveState, { dot: string; text: string }> = {
  connecting: { dot: "", text: "Connecting" },
  live: { dot: "live", text: "Live" },
  reconnecting: { dot: "danger", text: "Reconnecting" },
};

export function StatusChips({ live }: { live: LiveState }) {
  const { data } = useSystemStatus();
  const liveLabel = LIVE_LABEL[live];
  return (
    <div className="chips" aria-label="System status">
      <span className="chip" title="Updates are pushed from the server over Server-Sent Events">
        <span className={`dot ${liveLabel.dot}`} />
        {liveLabel.text}
      </span>
      {data && (
        <>
          <span
            className="chip"
            title={`Interval doubles after every ${data.config.pollBackoffEvery} unchanged polls, up to ${data.config.pollMaxIntervalSeconds}s`}
          >
            Polling every <strong>{data.config.pollIntervalSeconds}s</strong>
            <span className="faint">to {data.config.pollMaxIntervalSeconds}s</span>
          </span>
          <span className="chip">
            LLM{" "}
            {data.llm.enabled ? (
              <>
                <strong>{data.llm.model}</strong> · {data.llm.callsToday}/{data.llm.dailyCap} today
                {data.llm.paceHourly && <span className="faint"> · {data.llm.allowedSoFarToday} released</span>}
              </>
            ) : (
              <strong>disabled</strong>
            )}
          </span>
          {data.scheduler?.rateLimitedUntil && (
            <span className="chip warn">
              <span className="dot warn" />
              Rate limited until {new Date(data.scheduler.rateLimitedUntil).toLocaleTimeString()}
            </span>
          )}
        </>
      )}
    </div>
  );
}
