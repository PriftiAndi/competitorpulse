import { useEffect, useRef, type ReactNode } from "react";
import { Spinner } from "@/components/Spinner";

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation modal on top of the native <dialog>: focus trapping, Escape to
 * close and the backdrop come from the browser, so the only imperative bit is
 * syncing the `open` prop with showModal()/close().
 */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault(); // Escape: route through the same handler as the Cancel button
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel(); // backdrop click
      }}
    >
      <div className="dialog-body">
        <h3 id="dialog-title">{title}</h3>
        <div className="dialog-text">{children}</div>
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} disabled={busy} autoFocus>
            {busy && <Spinner />} {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
