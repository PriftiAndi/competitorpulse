export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spin ${className}`} role="status" aria-label="Loading" />;
}
