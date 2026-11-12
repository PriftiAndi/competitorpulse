import { useState, type FormEvent } from "react";
import { useAddCompetitor } from "@/api/queries";
import { Spinner } from "@/components/Spinner";
import { STATUS_LABEL } from "@/lib/status";

export function AddCompetitorForm() {
  const [id, setId] = useState("");
  const add = useAddCompetitor();
  const trimmed = id.trim();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate(trimmed, { onSuccess: () => setId("") });
  }

  return (
    <section className="card card-pad">
      <form onSubmit={onSubmit} className="add-form">
        <input
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Competitor id, e.g. acme-crm"
          aria-label="Competitor id"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <button type="submit" className="btn primary" disabled={add.isPending || trimmed === ""}>
          {add.isPending ? <Spinner /> : "+"} Track competitor
        </button>
      </form>
      {add.error && <div className="form-error">{add.error.message}</div>}
      <p className="hint">
        Any id is accepted and polled right away. If the source does not know it, the row shows
        &ldquo;{STATUS_LABEL.not_found}&rdquo; and polling continues in case it appears later.
      </p>
    </section>
  );
}
