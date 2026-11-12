import type { FieldChange } from "@/api/types";

export function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <ul className="changes">
      {changes.map((c) => (
        <li key={c.field}>
          <span className="field">{c.field}</span>
          <del>{c.before ?? "—"}</del>
          <span className="arrow">→</span>
          <ins>{c.after ?? "—"}</ins>
        </li>
      ))}
    </ul>
  );
}
