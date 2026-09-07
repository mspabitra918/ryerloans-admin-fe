"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Mail, MailX } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import type { ActionDefinition } from "./actions";

type FieldValue = string | string[];

/**
 * §8.4: "Every button opens a confirmation modal showing the exact email that
 * will be sent, with an 'edit before sending' option and a 'do not send email'
 * override that requires a reason (logged). Destructive actions (Decline, Fund)
 * require typing the Application ID to confirm."
 *
 * All four rules live here, once, for every action — see actions.ts.
 */
export function ActionModal({
  action,
  applicationId,
  approvedAmount,
  borrowerEmail,
  ecoaCodes,
  onClose,
  onDone,
}: {
  action: ActionDefinition | null;
  applicationId: string;
  borrowerEmail: string;
  approvedAmount?: number | null;
  ecoaCodes: Array<{ code: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [sendEmail, setSendEmail] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [editEmail, setEditEmail] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time a different action opens, so state never bleeds between
  // an abandoned Approve and the Decline the admin opens next.
  // useEffect(() => {
  //   if (!action) return;

  //   const defaults: Record<string, FieldValue> = {};

  //   for (const field of action.fields ?? []) {
  //     defaults[field.name] =
  //       field.type === "checklist" ? [] : String(field.defaultValue ?? "");
  //   }

  //   setValues(defaults);
  //   setSendEmail(true);
  //   setOverrideReason("");
  //   setEditEmail(false);
  //   setSubject("");
  //   setBody("");
  //   setNote("");
  //   setConfirmId("");
  //   setError(null);
  // }, [action]);

  useEffect(() => {
    if (!action) return;

    const defaults: Record<string, FieldValue> = {};

    for (const field of action.fields ?? []) {
      // Set approvedAmount for the fund action automatically
      if (action.key === "fund" && field.name === "funded_amount") {
        defaults[field.name] = String(approvedAmount ?? "");
      } else {
        defaults[field.name] =
          field.type === "checklist" ? [] : String(field.defaultValue ?? "");
      }
    }

    setValues(defaults);
    setSendEmail(true);
    setOverrideReason("");
    setEditEmail(false);
    setSubject("");
    setBody("");
    setNote("");
    setConfirmId("");
    setError(null);
  }, [action, approvedAmount]); // <-- ADD approvedAmount TO DEPENDENCY ARRAY

  const fields = useMemo(() => {
    if (!action?.fields) return [];

    // The ECOA list comes from the API so the codes the UI offers and the codes
    // the server accepts cannot drift apart.
    return action.fields.map((field) =>
      field.name === "reason_codes"
        ? {
            ...field,
            options: ecoaCodes.map((entry) => ({
              value: entry.code,
              label: entry.label,
            })),
          }
        : field,
    );
  }, [action, ecoaCodes]);

  if (!action) return null;

  const confirmSatisfied =
    !action.destructive ||
    confirmId.trim().toUpperCase() === applicationId.toUpperCase();

  const requiredSatisfied = fields.every((field) => {
    if (!field.required) return true;

    const value = values[field.name];

    return Array.isArray(value)
      ? value.length > 0
      : String(value ?? "").trim() !== "";
  });

  const overrideSatisfied = sendEmail || overrideReason.trim().length >= 3;

  const canSubmit =
    !busy && confirmSatisfied && requiredSatisfied && overrideSatisfied;

  async function submit() {
    if (!action) return;

    setBusy(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        ...Object.fromEntries(
          Object.entries(values)
            .filter(([, value]) =>
              Array.isArray(value)
                ? value.length > 0
                : String(value).trim() !== "",
            )
            .map(([key, value]) => {
              const field = fields.find((entry) => entry.name === key);

              return [key, field?.type === "number" ? Number(value) : value];
            }),
        ),
        send_email: sendEmail,
        ...(sendEmail ? {} : { email_override_reason: overrideReason.trim() }),
        ...(editEmail && subject.trim()
          ? { email_subject: subject.trim() }
          : {}),
        ...(editEmail && body.trim() ? { email_body: body.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(action.destructive
          ? { confirm_application_id: confirmId.trim().toUpperCase() }
          : {}),
      };

      const result = await api.action(
        applicationId,
        action.endpoint,
        payload,
        action.method ?? "PATCH",
      );

      /*
       * The action is recorded either way — the email is a side effect and is
       * reported separately. Announcing "email sent" off the request having
       * succeeded is how an admin ends up waiting on a reply to a message a
       * suppressed address was never going to receive.
       */
      if (!sendEmail) {
        toast.success(`${action.label} recorded`, {
          description: "Borrower email withheld; the reason was logged.",
        });
      } else if (result.email_sent) {
        toast.success(`${action.label} recorded`, {
          description: `Email sent to ${borrowerEmail}.`,
        });
      } else {
        toast.warning(`${action.label} recorded, but no email went out`, {
          description:
            result.email_withheld_reason === "suppressed"
              ? "This address is on the suppression list — unsubscribed, bounced or complained."
              : `The ${action.emailTemplate} email was not delivered (${
                  result.email_withheld_reason ?? "unknown reason"
                }). Check the email log.`,
        });
      }

      onDone();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "The action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title={action.label}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${action.destructive ? "btn-danger" : "btn-primary"}`}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : null}
            Confirm {action.label}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground-muted)]">
          {action.description}
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200"
          >
            {error}
          </p>
        ) : null}

        {/* {fields.map((field) => (
          <div key={field.name}>
            <label
              htmlFor={`field-${field.name}`}
              className="mb-1 block text-sm font-medium"
            >
              {field.label}
              {field.required ? (
                <span className="text-rose-600" aria-hidden>
                  {" *"}
                </span>
              ) : null}
            </label>

            {field.type === "checklist" ? (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                {(field.options ?? []).map((option) => {
                  const selected = (values[field.name] as string[]) ?? [];
                  const checked = selected.includes(option.value);

                  return (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--surface-muted)]"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={() =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: checked
                              ? selected.filter(
                                  (value) => value !== option.value,
                                )
                              : [...selected, option.value],
                          }))
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            ) : (
              <input
                id={`field-${field.name}`}
                className="field"
                type={field.type === "number" ? "number" : "text"}
                min={field.min}
                max={field.max}
                step={field.step}
                value={String(values[field.name] ?? "")}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.name]: event.target.value,
                  }))
                }
              />
            )}

            {field.hint ? (
              <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                {field.hint}
              </p>
            ) : null}
          </div>
        ))} */}

        {fields.map((field) => {
          const isFundAction =
            action.key === "fund" && field.name === "funded_amount";

          return (
            <div key={field.name}>
              <label
                htmlFor={`field-${field.name}`}
                className="mb-1 block text-sm font-medium"
              >
                {field.label}
                {field.required && !isFundAction ? (
                  <span className="text-rose-600" aria-hidden>
                    {" *"}
                  </span>
                ) : null}
              </label>

              {/* READ-ONLY DISPLAY FOR FUND ACTION */}
              {isFundAction ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--foreground)]">
                  {values[field.name]
                    ? `$${Number(values[field.name]).toLocaleString()}`
                    : "—"}
                </div>
              ) : field.type === "checklist" ? (
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                  {(field.options ?? []).map((option) => {
                    const selected = (values[field.name] as string[]) ?? [];
                    const checked = selected.includes(option.value);

                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--surface-muted)]"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() =>
                            setValues((current) => ({
                              ...current,
                              [field.name]: checked
                                ? selected.filter(
                                    (value) => value !== option.value,
                                  )
                                : [...selected, option.value],
                            }))
                          }
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <input
                  id={`field-${field.name}`}
                  className="field"
                  type={field.type === "number" ? "number" : "text"}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={String(values[field.name] ?? "")}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                />
              )}

              {field.hint ? (
                <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                  {field.hint}
                </p>
              ) : null}
            </div>
          );
        })}

        {/* ---------------------------------------------------- email panel */}
        {action.emailTemplate ? (
          <div className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                {sendEmail ? (
                  <Mail size={15} className="mt-0.5 shrink-0" aria-hidden />
                ) : (
                  <MailX
                    size={15}
                    className="mt-0.5 shrink-0 text-amber-600"
                    aria-hidden
                  />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {sendEmail ? "Email to be sent" : "No email will be sent"}
                  </p>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    <code className="font-mono">{action.emailTemplate}</code> →{" "}
                    {borrowerEmail}
                  </p>
                  <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                    {action.emailSummary}
                  </p>
                </div>
              </div>

              {/* <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={!sendEmail}
                  onChange={(event) => {
                    setSendEmail(!event.target.checked);
                    if (event.target.checked) setEditEmail(false);
                  }}
                />
                Do not send
              </label> */}
            </div>

            {/* {sendEmail ? (
              <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={editEmail}
                    onChange={(event) => setEditEmail(event.target.checked)}
                  />
                  Edit before sending
                </label>

                {editEmail ? (
                  <>
                    <input
                      className="field"
                      placeholder="Subject (leave blank to keep the default)"
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      aria-label="Email subject override"
                    />
                    <textarea
                      className="field min-h-28"
                      placeholder="Body (leave blank to keep the default). HTML is sent as written."
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      aria-label="Email body override"
                    />
                    <p className="text-xs text-[var(--foreground-muted)]">
                      Edited copy is recorded in the audit log against your
                      account.
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <label
                  htmlFor="override-reason"
                  className="mb-1 block text-xs font-medium"
                >
                  Reason for withholding the email
                  <span className="text-rose-600" aria-hidden>
                    {" *"}
                  </span>
                </label>
                <input
                  id="override-reason"
                  className="field"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="e.g. borrower notified by phone"
                />
                <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                  Logged to the audit log and the borrower&apos;s email history.
                </p>
              </div>
            )} */}
          </div>
        ) : null}

        {/* <div>
          <label htmlFor="action-note" className="mb-1 block text-sm font-medium">
            Internal note (optional)
          </label>
          <input
            id="action-note"
            className="field"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Recorded against the audit entry"
          />
        </div> */}

        {/* ------------------------------------------- destructive confirm */}
        {action.destructive ? (
          <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
            <p className="flex items-start gap-2 text-sm text-rose-800">
              <AlertTriangle
                size={15}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              This action cannot be undone. Type{" "}
              <code className="font-mono font-semibold">{applicationId}</code>{" "}
              to confirm.
            </p>
            <input
              className="field mt-2 font-mono"
              value={confirmId}
              onChange={(event) => setConfirmId(event.target.value)}
              aria-label="Type the application ID to confirm"
              autoComplete="off"
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
