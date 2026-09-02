"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, MailX, ShieldAlert } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/auth";
import { useSession } from "@/components/shell/SessionProvider";
import { Modal } from "@/components/ui/Modal";
import type { ApplicationDetail } from "@/lib/types";

/**
 * §8.4 "Edit Application — opens editable form; every field change logged
 * old→new with admin ID + timestamp; sends `application_updated` if a
 * borrower-visible field changed."
 *
 * This is the one §8.4 button that is not a state transition, so it does not
 * ride on ActionModal: its payload is a `changes` map rather than flat fields,
 * and SSN and bank account carry rules of their own.
 *
 * Only fields the admin actually touched are submitted. Sending the whole form
 * back would write an audit row for every field on the application each time
 * someone corrected a typo, which buries the one change that mattered.
 */

type FieldKind = "text" | "number" | "date" | "select";

interface EditField {
  name: string;
  label: string;
  kind?: FieldKind;
  options?: string[];
  hint?: string;
  /** Borrower-visible — changing it triggers the `application_updated` email. */
  visible?: boolean;
  /** SSN / bank account: super_admin, a mandatory note, and password re-entry. */
  sensitive?: boolean;
}

interface EditGroup {
  title: string;
  /** Which detail panel prefills this group. */
  panel: keyof Pick<
    ApplicationDetail,
    "personal" | "employment" | "vehicle" | "banking" | "loan_request"
  >;
  fields: EditField[];
}

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

/**
 * Mirrors EDITABLE_FIELDS in application-detail.service.ts. A field missing
 * here is simply not offered; a field here that the server does not accept is
 * rejected with "Not editable", which is the safer direction to be wrong in.
 */
const GROUPS: EditGroup[] = [
  {
    title: "Personal",
    panel: "personal",
    fields: [
      { name: "first_name", label: "First name", visible: true },
      { name: "last_name", label: "Last name", visible: true },
      { name: "email", label: "Email", visible: true },
      { name: "phone", label: "Phone", visible: true, hint: "Digits only are stored." },
      { name: "dob", label: "Date of birth", kind: "date" },
      { name: "dl_state", label: "Licence state", kind: "select", options: STATES },
      {
        name: "ssn",
        label: "SSN (replace)",
        sensitive: true,
        hint: "Leave blank to keep the value on file.",
      },
      {
        name: "dl_number",
        label: "Licence number (replace)",
        hint: "Leave blank to keep the value on file.",
      },
    ],
  },
  {
    title: "Address",
    panel: "personal",
    fields: [
      { name: "street_address", label: "Street address", visible: true },
      { name: "address_line_2", label: "Address line 2", visible: true },
      { name: "city", label: "City", visible: true },
      { name: "state", label: "State", kind: "select", options: STATES, visible: true },
      { name: "zip", label: "ZIP", visible: true },
      { name: "years_at_address", label: "Years at address", kind: "number" },
      { name: "housing_status", label: "Housing status" },
      { name: "monthly_housing_cost", label: "Monthly housing cost", kind: "number" },
    ],
  },
  {
    title: "Employment & income",
    panel: "employment",
    fields: [
      { name: "employment_status", label: "Employment status" },
      { name: "employer_name", label: "Employer" },
      { name: "job_title", label: "Job title" },
      { name: "employment_length_mo", label: "Months employed", kind: "number" },
      { name: "employer_phone", label: "Employer phone" },
      { name: "pay_frequency", label: "Pay frequency" },
      { name: "next_pay_date", label: "Next pay date", kind: "date" },
      { name: "net_monthly_income", label: "Net monthly income", kind: "number" },
      { name: "income_source", label: "Income source" },
    ],
  },
  {
    title: "Vehicle",
    panel: "vehicle",
    fields: [
      { name: "vehicle_year", label: "Year", kind: "number" },
      { name: "vehicle_make", label: "Make" },
      { name: "vehicle_model", label: "Model" },
    ],
  },
  {
    title: "Banking",
    panel: "banking",
    fields: [
      { name: "bank_name", label: "Bank name", visible: true },
      { name: "account_type", label: "Account type", kind: "select", options: ["Checking", "Savings"] },
      { name: "account_age_months", label: "Account age" },
      { name: "current_balance_band", label: "Current balance band" },
      {
        name: "account_number",
        label: "Account number (replace)",
        sensitive: true,
        hint: "Leave blank to keep the value on file.",
      },
      {
        name: "routing_number",
        label: "Routing number (replace)",
        sensitive: true,
        hint: "Leave blank to keep the value on file.",
      },
    ],
  },
  {
    title: "Loan request",
    panel: "loan_request",
    fields: [
      { name: "amount_requested", label: "Amount requested", kind: "number", visible: true },
      { name: "loan_purpose", label: "Purpose", visible: true },
      { name: "loan_purpose_other", label: "Purpose detail" },
    ],
  },
];

const ALL_FIELDS = GROUPS.flatMap((group) => group.fields);

/** Encrypted fields arrive masked, so they start blank and mean "replace". */
const REPLACE_ONLY = new Set(["ssn", "dl_number", "account_number", "routing_number"]);

function initialValue(
  detail: ApplicationDetail,
  group: EditGroup,
  field: EditField,
): string {
  if (REPLACE_ONLY.has(field.name)) return "";

  const raw = (detail[group.panel] as Record<string, unknown>)[field.name];

  if (raw === null || raw === undefined) return "";

  // The detail endpoint formats the phone for display; the server stores and
  // compares digits, so submitting the pretty version would register a change
  // that is not one.
  if (field.name === "phone" || field.name === "employer_phone") {
    return String(raw).replace(/\D/g, "");
  }

  // Dates arrive as ISO instants but <input type="date"> needs a bare day.
  if (field.kind === "date") return String(raw).slice(0, 10);

  return String(raw);
}

export function EditApplicationModal({
  open,
  detail,
  onClose,
  onDone,
}: {
  open: boolean;
  detail: ApplicationDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { admin } = useSession();
  const isSuperAdmin = can.editSensitive(admin?.role);

  const initial = useMemo(() => {
    const map: Record<string, string> = {};

    for (const group of GROUPS) {
      for (const field of group.fields) {
        map[field.name] = initialValue(detail, group, field);
      }
    }

    return map;
  }, [detail]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [sendEmail, setSendEmail] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setValues(initial);
    setSendEmail(true);
    setOverrideReason("");
    setNote("");
    setPassword("");
    setError(null);
  }, [open, initial]);

  const changedNames = ALL_FIELDS.filter((field) => {
    const next = values[field.name] ?? "";

    // A blank replace-only field means "leave it alone", not "clear it".
    if (REPLACE_ONLY.has(field.name)) return next.trim() !== "";

    return next !== (initial[field.name] ?? "");
  }).map((field) => field.name);

  const changedSensitive = changedNames.filter(
    (name) => ALL_FIELDS.find((field) => field.name === name)?.sensitive,
  );

  /*
   * Mirrors BORROWER_VISIBLE_FIELDS on the server so the modal can say, before
   * the admin commits, whether this edit will mail the borrower.
   */
  const willEmail = changedNames.some(
    (name) => ALL_FIELDS.find((field) => field.name === name)?.visible,
  );

  const canSubmit =
    !busy &&
    changedNames.length > 0 &&
    (changedSensitive.length === 0 ||
      (isSuperAdmin && note.trim().length >= 3 && password.length > 0)) &&
    (!willEmail || sendEmail || overrideReason.trim().length >= 3);

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const changes: Record<string, unknown> = {};

      for (const name of changedNames) {
        const field = ALL_FIELDS.find((entry) => entry.name === name)!;
        const raw = values[name] ?? "";

        changes[name] =
          field.kind === "number"
            ? Number(raw)
            : raw.trim() === ""
              ? null
              : raw.trim();
      }

      const result = await api.editApplication(detail.header.application_id, {
        changes,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(changedSensitive.length > 0 ? { password } : {}),
        send_email: sendEmail,
        ...(sendEmail ? {} : { email_override_reason: overrideReason.trim() }),
      });

      const count = result.changed_fields.length;

      if (!result.borrower_visible_change) {
        toast.success(`${count} field${count === 1 ? "" : "s"} updated`, {
          description: "No borrower-visible field changed, so no email was sent.",
        });
      } else if (result.email_sent) {
        toast.success(`${count} field${count === 1 ? "" : "s"} updated`, {
          description: "application_updated was emailed to the borrower.",
        });
      } else {
        toast.warning(`${count} field${count === 1 ? "" : "s"} updated`, {
          description: `No email went out (${
            result.email_withheld_reason ?? "unknown reason"
          }).`,
        });
      }

      onDone();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The edit failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      wide
      title="Edit application"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : null}
            Save {changedNames.length || "no"} change
            {changedNames.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground-muted)]">
          Every change is written to the audit log old→new against your account
          with a timestamp. Only fields you actually change are submitted.
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200"
          >
            {error}
          </p>
        ) : null}

        {GROUPS.map((group) => (
          <fieldset
            key={group.title}
            className="rounded-lg border border-[var(--border)] p-3"
          >
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
              {group.title}
            </legend>

            <div className="grid gap-3 sm:grid-cols-2">
              {group.fields.map((field) => {
                const locked = Boolean(field.sensitive) && !isSuperAdmin;
                const dirty = changedNames.includes(field.name);
                const id = `edit-${field.name}`;

                return (
                  <div key={field.name}>
                    <label
                      htmlFor={id}
                      className="mb-1 block text-xs font-medium"
                    >
                      {field.label}
                      {field.visible ? (
                        <span
                          className="ml-1 text-[var(--foreground-muted)]"
                          title="Borrower-visible — changing this emails them"
                        >
                          ✉
                        </span>
                      ) : null}
                    </label>

                    {field.kind === "select" ? (
                      <select
                        id={id}
                        className={`field ${dirty ? "ring-2 ring-amber-400" : ""}`}
                        disabled={locked}
                        value={values[field.name] ?? ""}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                      >
                        <option value="">—</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={id}
                        className={`field ${dirty ? "ring-2 ring-amber-400" : ""}`}
                        type={
                          field.kind === "number"
                            ? "number"
                            : field.kind === "date"
                              ? "date"
                              : "text"
                        }
                        disabled={locked}
                        autoComplete="off"
                        value={values[field.name] ?? ""}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                      />
                    )}

                    {locked ? (
                      <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                        Requires the super_admin role.
                      </p>
                    ) : field.hint ? (
                      <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                        {field.hint}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}

        {/* ----------------------------------- SSN / bank account extra gate */}
        {changedSensitive.length > 0 ? (
          <div className="space-y-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="flex items-start gap-2 text-sm text-amber-900">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              You are replacing {changedSensitive.join(", ")}. A reason and your
              password are required.
            </p>

            <input
              className="field"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reason for the change (required, logged)"
              aria-label="Reason for the change"
            />
            <input
              className="field"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              aria-label="Password"
              autoComplete="current-password"
            />
          </div>
        ) : null}

        {/* -------------------------------------------------- §8.4 email panel */}
        <div className="rounded-lg border border-[var(--border)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              {willEmail && sendEmail ? (
                <Mail size={15} className="mt-0.5 shrink-0" aria-hidden />
              ) : (
                <MailX
                  size={15}
                  className="mt-0.5 shrink-0 text-[var(--foreground-muted)]"
                  aria-hidden
                />
              )}
              <div>
                <p className="text-sm font-medium">
                  {!willEmail
                    ? "No email will be sent"
                    : sendEmail
                      ? "Email to be sent"
                      : "No email will be sent"}
                </p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  {willEmail ? (
                    <>
                      <code className="font-mono">application_updated</code> →{" "}
                      {String(detail.personal.email ?? "")}
                    </>
                  ) : (
                    "§8.4 only emails the borrower when a field they can see changes."
                  )}
                </p>
              </div>
            </div>

            {willEmail ? (
              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={!sendEmail}
                  onChange={(event) => setSendEmail(!event.target.checked)}
                />
                Do not send
              </label>
            ) : null}
          </div>

          {willEmail && !sendEmail ? (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <label
                htmlFor="edit-override-reason"
                className="mb-1 block text-xs font-medium"
              >
                Reason for withholding the email
                <span className="text-rose-600" aria-hidden>
                  {" *"}
                </span>
              </label>
              <input
                id="edit-override-reason"
                className="field"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="e.g. borrower dictated the correction on the phone"
              />
            </div>
          ) : null}
        </div>

        {changedSensitive.length === 0 ? (
          <div>
            <label htmlFor="edit-note" className="mb-1 block text-sm font-medium">
              Internal note (optional)
            </label>
            <input
              id="edit-note"
              className="field"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Recorded against the audit entry"
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
