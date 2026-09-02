import type { Capability } from "@/lib/auth";
import type { ApplicationStatus } from "@/lib/types";

export interface ActionField {
  name: string;
  label: string;
  type: "number" | "text" | "select" | "checklist";
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number;
}

export interface ActionDefinition {
  key: string;
  label: string;
  /** Path segment on /admin/applications/:id/… */
  endpoint: string;
  method?: "PATCH" | "POST";
  /** The email the borrower receives, quoted in the confirmation modal. */
  emailTemplate: string | null;
  emailSummary: string;
  /** Statuses this button is offered from. */
  from: ApplicationStatus[];
  /** §8.4: Decline and Fund require typing the Application ID. */
  destructive?: boolean;
  /**
   * §6.1 does not put this transition in an admin's hands — it happens on a
   * Plaid callback, a borrower e-signature, or automatically. The button still
   * exists, because a webhook that never arrives would otherwise strand the
   * file forever, but it is filed under "Manual override" rather than offered
   * as the normal way forward.
   */
  manual?: boolean;
  /** §8.1 capability this button needs. Re-checked by the route guard. */
  permission: Extract<
    Capability,
    | "markCalledIn"
    | "requestDocuments"
    | "casework"
    | "decide"
    | "fund"
    | "sendReviewInvitation"
  >;
  fields?: ActionField[];
  description: string;
}

/**
 * The §8.4 action table, as data.
 *
 * Every button shares one modal and one submit path, so a new action is a new
 * entry here rather than another bespoke dialog — which is how the "do not send
 * email" override and the destructive-confirm rule end up applying uniformly
 * instead of to whichever buttons someone remembered.
 */
export const ACTIONS: ActionDefinition[] = [
  {
    key: "called-in",
    label: "Mark as Called In",
    endpoint: "called-in",
    emailTemplate: "call_confirmed",
    emailSummary:
      "Confirms the call and tells the borrower to complete bank verification.",
    from: ["pending_call"],
    permission: "markCalledIn",
    description:
      "Records the call, cancels the call-reminder sequence, and advances the file to in review.",
  },
  {
    key: "request-documents",
    label: "Request Documents",
    endpoint: "request-documents",
    method: "POST",
    emailTemplate: "documents_requested",
    emailSummary:
      "Lists the requested documents and includes a secure upload link valid for 14 days.",
    from: [
      "pending_call",
      "in_review",
      "bank_verification_pending",
      "bank_verification_complete",
      "agreement_sent",
      "agreement_signed",
      "verification_deposit_sent",
      "verification_deposit_confirmed",
      "underwriting",
    ],
    permission: "requestDocuments",
    fields: [
      {
        name: "doc_types",
        label: "Documents to request",
        type: "checklist",
        required: true,
        options: [
          { value: "id", label: "Government-issued ID" },
          { value: "paystub", label: "Most recent paystub" },
          { value: "bank_statement", label: "Bank statement" },
          { value: "proof_of_address", label: "Proof of address" },
          { value: "void_check", label: "Void check" },
        ],
      },
    ],
    description:
      "Generates a one-time upload link and emails it to the borrower.",
  },
  {
    key: "send-bank-verification",
    label: "Send Bank Verification",
    endpoint: "send-bank-verification",
    emailTemplate: "bank_verification_requested",
    emailSummary: "Sends a fresh Plaid link to verify the borrower's account.",
    /*
     * pending_call is on this list because of the §6.1 bypass edge: the §7.1
     * bank verification drip starts on day 0, so a file can need a fresh link
     * before the borrower has ever called in.
     */
    from: ["pending_call", "in_review", "bank_verification_pending"],
    permission: "casework",
    manual: true,
    description: "Issues a new bank verification link.",
  },
  {
    key: "send-agreement",
    label: "Send Loan Agreement",
    endpoint: "send-agreement",
    emailTemplate: "agreement_sent",
    emailSummary:
      "Sends the loan agreement at the approved terms with an e-sign link.",
    /*
     * agreement_sent is here so an unsigned agreement can be re-sent: only the
     * borrower's signature moves a file out of that state, so an expired or
     * lost e-sign link would otherwise strand it with no button to press.
     * Re-sending revokes the previous link.
     */
    from: ["bank_verification_complete", "agreement_sent"],
    permission: "casework",
    description:
      "Generates the agreement and emails the e-sign link. Sending again " +
      "while the agreement is unsigned issues a fresh link and revokes the " +
      "previous one.",
  },
  {
    key: "send-verification-deposit",
    label: "Send Verification Deposit",
    endpoint: "send-verification-deposit",
    emailTemplate: "verification_deposit_sent",
    emailSummary:
      "Tells the borrower to expect a micro-deposit and to confirm the amount.",
    from: ["agreement_signed"],
    permission: "casework",
    /*
     * The borrower is later asked to reproduce these off their own statement,
     * so record what was actually sent. Cents, not dollars: the confirmation is
     * an exact match, and $0.27 typed as 0.27 into a float check fails a
     * borrower who answered correctly.
     */
    fields: [
      {
        name: "amount_1_cents",
        label: "First deposit (cents)",
        type: "number",
        required: true,
        min: 1,
        max: 99,
        hint: "Whole cents, 1\u201399. Ryer sends these into the borrower's account \u2014 never the other way round.",
      },
      {
        name: "amount_2_cents",
        label: "Second deposit (cents)",
        type: "number",
        required: true,
        min: 1,
        max: 99,
      },
    ],
    description:
      "Records the micro-deposit initiation and emails the borrower a one-time link to confirm the amounts.",
  },
  {
    key: "approve",
    label: "Approve",
    endpoint: "approve",
    emailTemplate: "approved",
    emailSummary: "Communicates the approved amount, APR, term and payment.",
    from: [
      // "received",
      // "pending_call",
      // "in_review",
      // "bank_verification_pending",
      // "bank_verification_complete",
      // "agreement_sent",
      // "agreement_signed",
      // "verification_deposit_sent",
      "verification_deposit_confirmed",
      "underwriting",
      // "approved",
    ],
    permission: "decide",
    fields: [
      {
        name: "term_months",
        label: "Term (months)",
        type: "number",
        required: true,
        min: 1,
        max: 120,
        defaultValue: 24,
      },
      {
        name: "apr",
        label: "APR (%)",
        type: "number",
        required: true,
        min: 0,
        max: 999.99,
        step: 0.01,
        defaultValue: 10,
      },
      {
        name: "amount",
        label: "Approved amount (optional)",
        type: "number",
        min: 1,
        hint: "Leave blank to approve the amount requested. Lower values are a counter-offer.",
      },
    ],
    description: "Sets the final terms and approves the application.",
  },
  {
    key: "decline",
    label: "Decline",
    endpoint: "decline",
    emailTemplate: "declined",
    emailSummary:
      "Adverse action notice. Legal review of this template is still outstanding.",
    /*
     * §6.1 branches to declined from the decision step and from nowhere else,
     * so this sits alongside Approve rather than trailing every state in the
     * pipeline. ALLOWED_TRANSITIONS enforces the same rule server-side — a file
     * needing an ECOA notice earlier has to be walked to underwriting first.
     */
    // from: ["underwriting"],
    from: [
      "received",
      "pending_call",
      "in_review",
      "bank_verification_pending",
      "bank_verification_complete",
      "agreement_sent",
      "agreement_signed",
      "verification_deposit_sent",
      "verification_deposit_confirmed",
      "underwriting",
      "approved",
    ],
    permission: "decide",
    destructive: true,
    fields: [
      {
        name: "reason_codes",
        label: "ECOA reason codes",
        type: "checklist",
        required: true,
        hint: "Regulation B requires the specific principal reasons. Select up to four.",
        options: [],
      },
    ],
    description:
      "Records the decline, its ECOA reasons, and a 90-day reapply date.",
  },
  {
    key: "fund",
    label: "Fund",
    endpoint: "fund",
    emailTemplate: "funded",
    emailSummary: "Confirms the disbursement amount and date.",
    from: ["approved"],
    permission: "fund",
    destructive: true,
    fields: [
      {
        name: "funded_amount",
        label: "Funded amount",
        type: "number",
        required: true,
        min: 1,
        hint: "Cannot exceed the approved amount.",
      },
    ],
    description: "Records the disbursement and closes the file as funded.",
  },
  {
    key: "send-review-invitation",
    label: "Send Review Invitation",
    endpoint: "send-review-invitation",
    method: "POST",
    emailTemplate: "review_request",
    emailSummary:
      "Invites the borrower to rate their experience, with a single-use link " +
      "valid for 30 days.",
    /*
     * §11 sends this automatically on day 7. The button is here for the file
     * that needs it sooner, or again — a bounced email, an address the
     * borrower has since corrected, an expired token. Re-sending supersedes
     * the previous link; a borrower who has already reviewed is refused.
     */
    from: ["funded"],
    permission: "sendReviewInvitation",
    description:
      "Emails the borrower a one-time link to the public review form. Sent " +
      "automatically seven days after funding — use this to send it early, " +
      "or to replace a link that expired.",
  },
  {
    key: "withdraw",
    label: "Withdraw",
    endpoint: "withdraw",
    emailTemplate: "application_withdrawn",
    emailSummary:
      "Confirms the application was closed at the borrower's request.",
    from: [
      "received",
      "pending_call",
      "in_review",
      "bank_verification_pending",
      "bank_verification_complete",
      "agreement_sent",
      "agreement_signed",
      "verification_deposit_sent",
      "verification_deposit_confirmed",
      "underwriting",
      "approved",
    ],
    permission: "casework",
    description: "Closes the application at the borrower's request.",
  },
];

export function actionsFor(status: ApplicationStatus): ActionDefinition[] {
  return ACTIONS.filter((action) => action.from.includes(status));
}
