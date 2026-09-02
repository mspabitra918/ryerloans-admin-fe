"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";

/** How long a revealed value stays on screen before it re-masks itself. */
const AUTO_HIDE_MS = 30_000;

/**
 * §8.3: "SSN and DL masked with a 'Reveal' control that requires password
 * re-entry and writes to audit_log."
 *
 * The revealed value is held in component state only and re-masks itself after
 * 30 seconds — a shoulder-surfable SSN left on a screen through a lunch break
 * defeats the point of gating it at all.
 */
export function RevealField({
  applicationId,
  field,
  label,
  masked,
  allowed,
}: {
  applicationId: string;
  field: string;
  label: string;
  masked: string | null;
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;

    const timer = window.setTimeout(() => setValue(null), AUTO_HIDE_MS);

    return () => window.clearTimeout(timer);
  }, [value]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await api.reveal(applicationId, field, password, reason);

      setValue(result.value);
      setOpen(false);
      setPassword("");
      setReason("");
      toast.info(`${label} revealed`, {
        description: "This disclosure was written to the audit log.",
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reveal.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="inline-flex items-center gap-2">
        <span className="font-mono tabular">{value ?? masked ?? "—"}</span>

        {masked && allowed ? (
          value ? (
            <button
              type="button"
              onClick={() => setValue(null)}
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              aria-label={`Hide ${label}`}
              title="Hide"
            >
              <EyeOff size={14} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[var(--accent)] hover:text-[var(--accent-strong)]"
              aria-label={`Reveal ${label}`}
              title="Reveal (requires password)"
            >
              <Eye size={14} aria-hidden />
            </button>
          )
        ) : masked ? (
          <span
            className="text-[var(--foreground-muted)]"
            title="Your role may not reveal this field"
          >
            <Lock size={13} aria-hidden />
          </span>
        ) : null}
      </span>

      <Modal
        open={open}
        title={`Reveal ${label}`}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
      >
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-[var(--foreground-muted)]">
            Re-enter your password to reveal this value. The disclosure is
            recorded in the audit log against your account and IP address.
          </p>

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200"
            >
              {error}
            </p>
          ) : null}

          <div>
            <label
              htmlFor={`reveal-password-${field}`}
              className="mb-1 block text-sm font-medium"
            >
              Password
            </label>
            <input
              id={`reveal-password-${field}`}
              type="password"
              className="field"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor={`reveal-reason-${field}`}
              className="mb-1 block text-sm font-medium"
            >
              Reason
            </label>
            <input
              id={`reveal-reason-${field}`}
              className="field"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. verifying identity on an inbound call"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <Eye size={15} aria-hidden />
              )}
              Reveal
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
