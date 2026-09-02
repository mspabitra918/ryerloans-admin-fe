"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Rendered as a native <dialog> so focus trapping, the backdrop, inertness of
 * the page behind it and Escape-to-close come from the platform rather than
 * from hand-rolled key handlers that miss a case.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      className={`m-auto w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--foreground)] backdrop:bg-slate-900/50 ${
        wide ? "max-w-3xl" : "max-w-lg"
      }`}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

      {footer ? (
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
