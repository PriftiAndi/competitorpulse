import type { Snapshot } from "@/api/types";

const FIELDS = [
  { key: "title", label: "Title" },
  { key: "tagline", label: "Tagline" },
  { key: "price", label: "Price", mono: true },
  { key: "description", label: "Description" },
] as const;

export function SnapshotFields({ snapshot }: { snapshot: Snapshot }) {
  return (
    <dl className="fields">
      {FIELDS.map(({ key, label, ...opts }) => {
        const value = snapshot[key];
        const carried = snapshot.missingFields.includes(key);
        return (
          <FieldRow key={key} label={label} mono={"mono" in opts}>
            {value ?? <span className="faint">—</span>}
            {carried && <div className="carried">Not returned by the source in this poll · showing last known value</div>}
          </FieldRow>
        );
      })}
    </dl>
  );
}

function FieldRow({ label, mono, children }: { label: string; mono: boolean; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? "price" : undefined}>{children}</dd>
    </>
  );
}
