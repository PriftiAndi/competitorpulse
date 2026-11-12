import { Link } from "react-router-dom";
import type { LiveState } from "@/api/live";
import { PulseIcon } from "@/components/icons";
import { StatusChips } from "@/components/StatusChips";

export function AppBar({ live }: { live: LiveState }) {
  return (
    <header className="appbar">
      <div className="appbar-inner">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <PulseIcon />
          </span>
          CompetitorPulse
        </Link>
        <StatusChips live={live} />
      </div>
    </header>
  );
}
