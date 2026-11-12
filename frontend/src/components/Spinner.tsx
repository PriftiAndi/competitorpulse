/** Decorative spinner: the surrounding text carries the meaning, so it is hidden from assistive tech. */
export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spin ${className}`} aria-hidden="true" />;
}
