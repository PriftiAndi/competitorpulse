export function CompetitorStats({ total, changed, unavailable }: { total: number; changed: number; unavailable: number }) {
  return (
    <section className="stats">
      <div className="card stat">
        <div className="stat-label">Tracked</div>
        <div className="stat-value">{total}</div>
      </div>
      <div className="card stat">
        <div className="stat-label">Changed in last 24h</div>
        <div className="stat-value" style={changed > 0 ? { color: "var(--changed)" } : undefined}>
          {changed} <small>/ {total}</small>
        </div>
      </div>
      <div className="card stat">
        <div className="stat-label">Not listed / failing</div>
        <div className="stat-value" style={unavailable > 0 ? { color: "var(--warn)" } : undefined}>
          {unavailable}
        </div>
      </div>
    </section>
  );
}
