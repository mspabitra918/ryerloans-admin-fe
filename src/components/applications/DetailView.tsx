"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  Send,
  ShieldAlert,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/auth";
import { useSession } from "@/components/shell/SessionProvider";
import {
  bytes,
  day,
  money,
  moneyPrecise,
  percent,
  titleCase,
  when,
} from "@/lib/format";
import { Panel, Row } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { ErrorState, Spinner } from "@/components/ui/States";
import { Timeline } from "./Timeline";
import { RevealField } from "./RevealField";
import { ActionModal } from "./ActionModal";
import { EditApplicationModal } from "./EditApplicationModal";
import { actionsFor, type ActionDefinition } from "./actions";
import type { ApplicationDetail, FilterOptions } from "@/lib/types";
import { useRouter } from "next/navigation";

/** Narrowing helpers — panels arrive as Record<string, unknown> from the API. */
const str = (panel: Record<string, unknown>, key: string): string | null => {
  const value = panel[key];
  return value === null || value === undefined ? null : String(value);
};

const num = (panel: Record<string, unknown>, key: string): number | null => {
  const value = panel[key];
  return typeof value === "number" ? value : value ? Number(value) : null;
};

const bool = (panel: Record<string, unknown>, key: string): boolean =>
  Boolean(panel[key]);

export function DetailView({ applicationId }: { applicationId: string }) {
  const { admin } = useSession();
  const router = useRouter();

  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<ActionDefinition | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setDetail(await api.detail(applicationId));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load this application.",
      );
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .filters()
      .then(setOptions)
      .catch(() => {});
  }, []);

  async function submitNote(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;

    setSavingNote(true);

    try {
      await api.addNote(applicationId, note.trim());
      setNote("");
      toast.success("Note added");
      await load();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError
          ? caught.message
          : "Could not save the note.",
      );
    } finally {
      setSavingNote(false);
    }
  }

  async function resend(emailLogId: string) {
    try {
      const result = await api.resendEmail(applicationId, emailLogId);

      if (result.resent) {
        toast.success("Email resent");
      } else {
        // A suppressed address returns 200 with nothing delivered. Reporting
        // that as success is how an admin ends up waiting on a reply to an
        // email the borrower was never going to receive.
        toast.warning("Nothing was sent", {
          description:
            result.reason === "suppressed"
              ? "This address is on the suppression list — unsubscribed, bounced or complained."
              : "The provider did not accept the message. Check the email log.",
        });
      }

      await load();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "Could not resend.",
      );
    }
  }

  /**
   * §8.3 download.
   *
   * The bytes are fetched on the admin's session and saved from an object URL
   * rather than being reached through a link. There is no shareable URL at any
   * point — nothing to paste into a chat window, and nothing left in the
   * browser's history pointing at a borrower's ID.
   */
  async function download(documentId: string) {
    setDownloading(documentId);

    try {
      const file = await api.documentBlob(documentId);
      const url = URL.createObjectURL(file.blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();

      // Same-tick revocation cancels the save in Safari; the next frame is
      // late enough for every browser to have taken the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      toast.error(
        caught instanceof ApiError
          ? caught.message
          : "Could not open that document.",
      );
    } finally {
      setDownloading(null);
    }
  }

  async function assign(adminUserId: string) {
    try {
      await api.assignAgent(applicationId, adminUserId || null);
      toast.success(adminUserId ? "Agent assigned" : "Assignment cleared");
      await load();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "Could not assign.",
      );
    }
  }

  if (loading && !detail) return <Spinner label="Loading application…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) return null;

  const { header, personal, banking, employment, provenance, decision } =
    detail;
  const loan = detail.loan_request;
  const vehicle = detail.vehicle;

  // The action table names its own §8.1 capability, so this is a lookup rather
  // than a switch that has to be extended every time a button is added.
  const permitted = (action: ActionDefinition) =>
    can[action.permission](admin?.role);

  /*
   * §6.1 marks only three transitions as an admin's to make — Mark as Called
   * In, Send Loan Agreement, Send Verification Deposit — and the rest of the
   * pipeline moves on a Plaid callback, a borrower e-signature, or by itself.
   * The buttons that stand in for those events are kept (a webhook that never
   * arrives would otherwise strand the file) but split off below, so the row
   * an admin reads first offers only what §6.1 and §8.4 actually ask them to
   * do.
   */
  const available = actionsFor(header.status).filter(permitted);
  const primary = available.filter((action) => !action.manual);
  const overrides = available.filter((action) => action.manual);

  /*
   * A closed file is a record, not a draft. Editing a declined or funded
   * application after the fact would rewrite the facts the decision was made
   * on, so the form is withdrawn once the file comes to rest.
   */
  const canEdit =
    can.edit(admin?.role) &&
    !["declined", "funded", "withdrawn", "expired"].includes(header.status);
  const warnings = (provenance.warnings ?? []) as Array<{
    code: string;
    message: string;
  }>;

  console.log("DetailView: detail", detail?.loan_request?.amount_requested);

  return (
    <div className="space-y-4">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft size={15} aria-hidden />
        Back to applications
      </button>

      {/* ------------------------------------------------------------ header */}
      <header className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold">
                {header.application_id}
              </span>
              <StatusPill status={header.status} label={header.status_label} />
              {header.possible_duplicate ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-300">
                  <Copy size={12} aria-hidden />
                  Possible duplicate
                </span>
              ) : null}
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              {header.full_name}
            </h1>
            <p className="text-sm text-[var(--foreground-muted)]">
              {money(header.amount_requested)} requested · submitted{" "}
              {when(header.submitted_at)}
            </p>
          </div>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--foreground-muted)]">
              Assigned agent
            </span>
            <select
              className="field min-w-52"
              value={header.assigned_agent?.id ?? ""}
              disabled={!can.casework(admin?.role)}
              onChange={(event) => void assign(event.target.value)}
            >
              <option value="">Unassigned</option>
              {options?.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.email}
                </option>
              ))}
            </select>
          </label>
        </div>

        {available.length > 0 || canEdit ? (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap gap-2">
              {primary.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => setOpenAction(action)}
                  className={`btn ${action.destructive ? "btn-danger" : "btn-secondary"}`}
                >
                  {action.label}
                </button>
              ))}

              {/*
              §8.4 "Edit Application" is not a state transition, so it is not in
              the status-driven table: it stays available on any open file, and
              is the one button whose email depends on what was changed rather
              than on which button was pressed.
            */}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="btn btn-secondary"
                >
                  Edit Application
                </button>
              ) : null}
            </div>

            {/*
              Collapsed by default. These record something that was supposed to
              arrive on its own, so reaching for one is a decision an admin
              should have to make deliberately rather than a button sitting in
              the same row as Approve.
            */}
            {overrides.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
                  Manual override ({overrides.length})
                </summary>
                <div className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3">
                  <p className="mb-2 text-xs text-[var(--foreground-muted)]">
                    This step normally advances on its own — a Plaid callback, a
                    borrower e-signature, or the next automatic transition. Use
                    these only to record something that happened out of band.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {overrides.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        onClick={() => setOpenAction(action)}
                        className="btn btn-secondary"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--foreground-muted)]">
            No actions are available from this status for your role.
          </p>
        )}
      </header>

      {warnings.length > 0 ? (
        <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
          {warnings.map((warning) => (
            <p
              key={warning.code}
              className="flex items-start gap-2 text-sm text-amber-900"
            >
              <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              {warning.message}
            </p>
          ))}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ panels */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Loan request">
              <dl>
                <Row
                  label="Amount"
                  value={money(num(loan, "amount_requested"))}
                />
                <Row label="Purpose" value={str(loan, "loan_purpose")} />
                {str(loan, "loan_purpose_other") ? (
                  <Row label="Detail" value={str(loan, "loan_purpose_other")} />
                ) : null}
                <Row
                  label={`Payment at ${num(loan, "illustrative_apr")}% APR`}
                  value={moneyPrecise(num(loan, "estimated_monthly_payment"))}
                  mono
                />
                <Row
                  label="Term"
                  value={`${num(loan, "illustrative_term_months")} months`}
                />
              </dl>
            </Panel>

            <Panel title="Personal">
              <dl>
                <Row label="Email" value={str(personal, "email")} />
                <Row label="Phone" value={str(personal, "phone")} mono />
                <Row label="Date of birth" value={day(str(personal, "dob"))} />
                <Row
                  label="SSN"
                  value={
                    <RevealField
                      applicationId={applicationId}
                      field="ssn"
                      label="SSN"
                      masked={str(personal, "ssn_masked")}
                      allowed={can.reveal(admin?.role)}
                    />
                  }
                />
                <Row
                  label="Driver's licence"
                  value={
                    <RevealField
                      applicationId={applicationId}
                      field="dl_number"
                      label="Driver's licence"
                      masked={str(personal, "dl_number_masked")}
                      allowed={can.reveal(admin?.role)}
                    />
                  }
                />
                <Row label="Licence state" value={str(personal, "dl_state")} />
                <Row
                  label="Address"
                  value={
                    <span className="block text-right">
                      {str(personal, "street_address")}
                      {str(personal, "address_line_2")
                        ? `, ${str(personal, "address_line_2")}`
                        : ""}
                      <br />
                      {str(personal, "city")}, {str(personal, "state")}{" "}
                      {str(personal, "zip")}
                    </span>
                  }
                />
                <Row
                  label="Years at address"
                  value={str(personal, "years_at_address")}
                />
                <Row label="Housing" value={str(personal, "housing_status")} />
              </dl>
            </Panel>

            <Panel title="Employment & income">
              <dl>
                <Row
                  label="Status"
                  value={str(employment, "employment_status")}
                />
                <Row
                  label="Employer"
                  value={str(employment, "employer_name")}
                />
                <Row label="Job title" value={str(employment, "job_title")} />
                <Row
                  label="Length"
                  value={
                    num(employment, "employment_length_mo")
                      ? `${num(employment, "employment_length_mo")} months`
                      : null
                  }
                />
                <Row
                  label="Pay frequency"
                  value={str(employment, "pay_frequency")}
                />
                <Row
                  label="Next pay date"
                  value={day(str(employment, "next_pay_date"))}
                />
                <Row
                  label="Net monthly income"
                  value={money(num(employment, "net_monthly_income"))}
                />
                <Row
                  label="Housing cost"
                  value={money(num(employment, "monthly_housing_cost"))}
                />
                <Row
                  label="DTI (housing + loan)"
                  value={percent(
                    (employment.dti as { percent: number | null } | undefined)
                      ?.percent ?? null,
                  )}
                />
              </dl>
            </Panel>

            <Panel title="Banking">
              <dl>
                <Row label="Bank" value={str(banking, "bank_name")} />
                <Row
                  label="Account type"
                  value={str(banking, "account_type")}
                />
                <Row
                  label="Account number"
                  value={
                    <RevealField
                      applicationId={applicationId}
                      field="account_number"
                      label="Account number"
                      masked={str(banking, "account_masked")}
                      allowed={can.reveal(admin?.role)}
                    />
                  }
                />
                <Row
                  label="Routing number"
                  value={
                    <RevealField
                      applicationId={applicationId}
                      field="routing_number"
                      label="Routing number"
                      masked={str(banking, "routing_masked")}
                      allowed={can.reveal(admin?.role)}
                    />
                  }
                />
                <Row
                  label="Account age"
                  value={str(banking, "account_age_months")}
                />
                <Row
                  label="Balance band"
                  value={str(banking, "current_balance_band")}
                />
                <Row
                  label="Direct deposit"
                  value={
                    banking.direct_deposit === null
                      ? "—"
                      : bool(banking, "direct_deposit")
                        ? "Yes"
                        : "No"
                  }
                />
                <Row
                  label="Verification"
                  value={titleCase(str(banking, "verification_status") ?? "")}
                />
                <Row
                  label="Verified at"
                  value={when(str(banking, "bank_verified_at"))}
                />
              </dl>
            </Panel>

            <Panel title="Vehicle">
              {bool(vehicle, "owns_vehicle") ? (
                <dl>
                  <Row label="Year" value={str(vehicle, "vehicle_year")} />
                  <Row label="Make" value={str(vehicle, "vehicle_make")} />
                  <Row label="Model" value={str(vehicle, "vehicle_model")} />
                  <Row
                    label="Paid off"
                    value={
                      vehicle.vehicle_paid_off === null
                        ? "—"
                        : bool(vehicle, "vehicle_paid_off")
                          ? "Yes"
                          : "No"
                    }
                  />
                </dl>
              ) : (
                <p className="py-2 text-sm text-[var(--foreground-muted)]">
                  No vehicle reported.
                </p>
              )}
            </Panel>

            <Panel title="Decision">
              <dl>
                <Row
                  label="Decision"
                  value={titleCase(str(decision, "decision") ?? "")}
                />
                <Row
                  label="Decided at"
                  value={when(str(decision, "decision_at"))}
                />
                <Row
                  label="Approved APR"
                  value={
                    num(decision, "approved_apr") !== null
                      ? `${num(decision, "approved_apr")}%`
                      : null
                  }
                />
                <Row
                  label="Approved term"
                  value={
                    num(decision, "approved_term_months")
                      ? `${num(decision, "approved_term_months")} months`
                      : null
                  }
                />
                <Row
                  label="Funded"
                  value={money(num(decision, "funded_amount"))}
                />
                <Row
                  label="Funded at"
                  value={when(str(decision, "funded_at"))}
                />
                {Array.isArray(decision.decline_reason_codes) &&
                decision.decline_reason_codes.length > 0 ? (
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    <dt className="mb-1 text-xs text-[var(--foreground-muted)]">
                      ECOA reasons
                    </dt>
                    <dd>
                      <ul className="list-inside list-disc text-sm">
                        {(
                          decision.decline_reason_codes as Array<{
                            code: string;
                            label: string;
                          }>
                        ).map((reason) => (
                          <li key={reason.code}>{reason.label}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
                <Row
                  label="Adverse action ref"
                  value={str(decision, "adverse_action_reference")}
                  mono
                />
                <Row
                  label="May reapply"
                  value={day(str(decision, "reapply_eligible_date"))}
                />
              </dl>
            </Panel>
          </div>

          <Panel title="Provenance">
            <dl className="grid gap-x-8 md:grid-cols-2">
              <Row
                label="IP address"
                value={str(provenance, "ip_address")}
                mono
              />
              <Row
                label="Geolocation"
                value={[
                  str(provenance, "ip_region"),
                  str(provenance, "ip_country"),
                ]
                  .filter(Boolean)
                  .join(", ")}
              />
              <Row
                label="Device"
                value={titleCase(str(provenance, "device_type") ?? "")}
              />
              <Row label="Referrer" value={str(provenance, "referrer")} />
              <Row
                label="Landing page"
                value={str(provenance, "landing_page")}
              />
              <Row
                label="UTM source"
                value={
                  (provenance.utm as { source?: string } | undefined)?.source ??
                  "direct"
                }
              />
              <Row
                label="UTM medium"
                value={
                  (provenance.utm as { medium?: string } | undefined)?.medium
                }
              />
              <Row
                label="UTM campaign"
                value={
                  (provenance.utm as { campaign?: string } | undefined)
                    ?.campaign
                }
              />
              <Row
                label="Form duration"
                value={
                  num(provenance, "form_duration_seconds") !== null ? (
                    <span
                      className={
                        bool(provenance, "form_duration_suspicious")
                          ? "text-amber-600"
                          : ""
                      }
                    >
                      {num(provenance, "form_duration_seconds")}s
                      {bool(provenance, "form_duration_suspicious") ? (
                        <AlertTriangle
                          size={13}
                          className="ml-1 inline"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  ) : null
                }
              />
              <Row
                label="User agent"
                value={
                  <span
                    className="block max-w-xs truncate text-xs"
                    title={str(provenance, "user_agent") ?? ""}
                  >
                    {str(provenance, "user_agent")}
                  </span>
                }
              />
            </dl>
          </Panel>

          <Panel title="Documents">
            {detail.documents.length === 0 ? (
              <p className="py-2 text-sm text-[var(--foreground-muted)]">
                No documents uploaded.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {detail.documents.map((document) => (
                  <li
                    key={document.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {document.original_filename}
                      </p>
                      <p className="text-xs text-[var(--foreground-muted)]">
                        {titleCase(document.doc_type)} ·{" "}
                        {bytes(document.size_bytes)} ·{" "}
                        {when(document.created_at)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <ScanBadge status={document.scan_status} />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void download(document.id)}
                        disabled={
                          !document.downloadable || downloading === document.id
                        }
                        title={
                          document.downloadable
                            ? "Download"
                            : "Unavailable until the virus scan passes"
                        }
                        aria-label={`Download ${document.original_filename}`}
                      >
                        {downloading === document.id ? (
                          <Loader2
                            size={14}
                            className="animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <Download size={14} aria-hidden />
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Emails">
            {detail.emails.length === 0 ? (
              <p className="py-2 text-sm text-[var(--foreground-muted)]">
                No email has been sent yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {detail.emails.map((email) => (
                  <li
                    key={email.id}
                    className="flex items-start justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">{email.subject}</p>
                      <p className="text-xs text-[var(--foreground-muted)]">
                        <code className="font-mono">{email.template_key}</code>{" "}
                        · {email.status}
                        {email.sent_at ? ` · sent ${when(email.sent_at)}` : ""}
                        {email.opened_at ? " · opened" : ""}
                        {email.bounced_at ? " · bounced" : ""}
                        {email.cancelled_reason
                          ? ` · ${email.cancelled_reason}`
                          : ""}
                      </p>
                    </div>

                    {email.resendable && can.resendEmail(admin?.role) ? (
                      <button
                        type="button"
                        className="btn btn-secondary shrink-0"
                        onClick={() => void resend(email.id)}
                      >
                        <Send size={14} aria-hidden />
                        Resend
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* --------------------------------------------------- right column */}
        <div className="space-y-4">
          <Panel title="Notes">
            {can.notes(admin?.role) ? (
              <form onSubmit={submitNote} className="mb-3 space-y-2">
                <textarea
                  className="field min-h-20"
                  placeholder="Add an internal note…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  aria-label="New internal note"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Notes are append-only and cannot be edited or deleted.
                  </p>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={savingNote || !note.trim()}
                  >
                    {savingNote ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : null}
                    Add
                  </button>
                </div>
              </form>
            ) : null}

            {detail.notes.length === 0 ? (
              <p className="text-sm text-[var(--foreground-muted)]">
                No notes yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {detail.notes.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-lg bg-[var(--surface-muted)] p-3"
                  >
                    <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
                    <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                      {entry.author_email ?? "Unknown"} ·{" "}
                      {when(entry.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Timeline">
            <Timeline entries={detail.timeline} />
          </Panel>
        </div>
      </div>

      <ActionModal
        action={openAction}
        applicationId={applicationId}
        approvedAmount={
          typeof detail?.loan_request?.amount_requested === "number"
            ? detail.loan_request.amount_requested
            : undefined
        }
        borrowerEmail={str(personal, "email") ?? ""}
        ecoaCodes={options?.ecoa_reason_codes ?? []}
        onClose={() => setOpenAction(null)}
        onDone={() => void load()}
      />

      {canEdit ? (
        <EditApplicationModal
          open={editing}
          detail={detail}
          onClose={() => setEditing(false)}
          onDone={() => void load()}
        />
      ) : null}
    </div>
  );
}

function ScanBadge({ status }: { status: string }) {
  const tone =
    status === "clean"
      ? "bg-emerald-100 text-emerald-800 ring-emerald-300"
      : status === "infected"
        ? "bg-rose-100 text-rose-800 ring-rose-300"
        : "bg-amber-100 text-amber-800 ring-amber-300";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
      title="Virus scan status"
    >
      {titleCase(status)}
    </span>
  );
}
