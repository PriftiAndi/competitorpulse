import type { ReactNode } from "react";

export type PillTone = "ok" | "partial" | "not_found" | "error" | "changed" | "neutral";

export function Pill({ tone, children, title }: { tone: PillTone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${tone}`} title={title}>
      {children}
    </span>
  );
}
