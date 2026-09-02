/** Mirrors the backend §8.1 role matrix. */
export type AdminRole =
  "super_admin" | "underwriter" | "funding" | "agent" | "read_only";

export type ApplicationStatus =
  | "received"
  | "pending_call"
  | "in_review"
  | "bank_verification_pending"
  | "bank_verification_complete"
  | "agreement_sent"
  | "agreement_signed"
  | "verification_deposit_sent"
  | "verification_deposit_confirmed"
  | "underwriting"
  | "approved"
  | "funded"
  | "declined"
  | "withdrawn"
  | "expired";

export interface AdminIdentity {
  id: string;
  email: string;
  role: AdminRole;
  sessionId: string;
  ipAddress: string;
}

export interface LoginChallenge {
  mfa_required: true;
  mfa_stage: "verify" | "enroll";
  challenge_token: string;
  expires_in: number;
  enrollment?: {
    secret: string;
    otpauth_url: string;
    qr_data_url: string;
  };
}

export interface LoginSuccess {
  access_token: string;
  /** Seconds the access token stays valid — minutes, not the session length. */
  expires_in: number;
  /**
   * Exchanged at POST /auth/refresh for a fresh pair. Single use: the backend
   * treats a second presentation as a stolen token and ends every session the
   * admin holds, so exactly one caller may ever spend a given token.
   */
  refresh_token: string;
  /** Seconds until the refresh token dies — the session's absolute cap. */
  refresh_expires_in: number;
  idle_timeout_seconds: number;
  admin: {
    id: string;
    email: string;
    login_id: string;
    role: AdminRole;
    last_login_at: string | null;
  };
}

export interface SearchResultRow {
  id: string;
  application_id: string;
  status: ApplicationStatus;
  status_label: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  state: string;
  amount_requested: number;
  loan_purpose: string;
  ssn_masked: string | null;
  account_masked: string | null;
  called_in: boolean;
  bank_verified: boolean;
  possible_duplicate: boolean;
  assigned_agent: { id: string; email: string } | null;
  utm_source: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SearchResponse {
  results: SearchResultRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  exact_match: string | null;
  detected:
    "application_id" | "email" | "phone" | "ssn_last4" | "name" | "none";
}

export interface FilterOptions {
  states: string[];
  utm_sources: string[];
  loan_purposes: string[];
  agents: Array<{ id: string; email: string; role: AdminRole }>;
  document_types: Array<{ value: string; label: string }>;
  ecoa_reason_codes: Array<{ code: string; label: string }>;
}

export interface TimelineEntry {
  at: string;
  kind: "status" | "admin_action" | "email" | "document" | "note" | "milestone";
  label: string;
  detail?: string | null;
  actor?: string | null;
  meta?: Record<string, unknown>;
}

export interface NoteView {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_email: string | null;
}

export interface DocumentView {
  id: string;
  doc_type: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  scan_status: string;
  scanned_at: string | null;
  uploaded_by: string;
  created_at: string;
  downloadable: boolean;
}

export interface EmailView {
  id: string;
  template_key: string;
  subject: string;
  to_email: string;
  status: string;
  scheduled_for: string | null;
  sent_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  complaint_at: string | null;
  cancelled_reason: string | null;
  resendable: boolean;
}

export interface ApplicationDetail {
  header: {
    id: string;
    application_id: string;
    full_name: string;
    status: ApplicationStatus;
    status_label: string;
    amount_requested: number;
    submitted_at: string | null;
    assigned_agent: { id: string; email: string } | null;
    possible_duplicate: boolean;
  };
  loan_request: Record<string, unknown>;
  personal: Record<string, unknown>;
  employment: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  banking: Record<string, unknown>;
  decision: Record<string, unknown>;
  provenance: Record<string, unknown>;
  timeline: TimelineEntry[];
  documents: DocumentView[];
  notes: NoteView[];
  emails: EmailView[];
}

export interface FunnelStage {
  stage: string;
  label: string;
  count: number;
  conversion_from_previous_percent: number | null;
  conversion_from_received_percent: number | null;
  drop_off_from_previous: number;
}

export interface DashboardStats {
  generated_at: string;
  timezone: string;
  range: { key: string; start: string | null; end: string };
  applications: { today: number; week: number; month: number; total: number };
  funnel: FunnelStage[];
  outcomes: {
    approved: number;
    funded: number;
    declined: number;
    withdrawn: number;
    expired: number;
  };
  performance: {
    called_in_within_24h_percent: number | null;
    called_in_within_24h: number;
    called_in_24h_eligible: number;
    called_in_percent: number | null;
    bank_verified_percent: number | null;
    average_time_to_fund_hours: number | null;
    median_time_to_fund_hours: number | null;
    funded_count: number;
  };
  decline_reasons: Array<{
    code: string;
    label: string;
    count: number;
    percent: number | null;
  }>;
  applications_by_state: Array<{
    state: string;
    count: number;
    percent: number | null;
  }>;
  traffic_sources: Array<{
    source: string;
    count: number;
    percent: number | null;
  }>;
  queues: Array<{ status: ApplicationStatus; label: string; count: number }>;
  agent_workload: Array<{
    admin_user_id: string | null;
    email: string;
    open: number;
    total: number;
  }>;
  flagged_duplicates: { total: number; open: number };
  email: {
    queued: number;
    sent: number;
    delivered: number;
    bounced: number;
    complaints: number;
    failed: number;
    cancelled: number;
    opened: number;
    bounce_rate_percent: number;
    complaint_rate_percent: number;
    open_rate_percent: number;
  };
}

export interface AdminUserView {
  id: string;
  login_id: string;
  email: string;
  role: AdminRole;
  mfa_enabled: boolean;
  is_active: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  locked_until: string | null;
  created_at: string | null;
}

/** Body shared by every §8.4 action. */
export interface AdminActionBody {
  send_email?: boolean;
  email_override_reason?: string;
  email_subject?: string;
  email_body?: string;
  note?: string;
}

export interface ActionResult {
  id: string;
  application_id: string;
  status: ApplicationStatus;
  email_sent: boolean;
  email_withheld_reason?: string;
}

/* ------------------------------------------------------------ §11 reviews */

export type ReviewState = "invited" | "submitted" | "published" | "rejected";

export type ReviewFilter = "pending" | "published" | "rejected" | "all";

/** One review in the moderation queue, with the file it came from. */
export interface ReviewModerationView {
  id: string;
  application_id: string;
  reference: string;
  rating: number | null;
  review_text: string | null;
  display_name: string | null;
  display_name_preference: string | null;
  consent_to_publish: boolean;
  submitted_at: string | null;
  sent_at: string;
  expires_at: string;
  moderated_at: string | null;
  moderation_reason: string | null;
  is_published: boolean;
  state: ReviewState;
}

export interface ReviewModerationOptions {
  rejection_reasons: Array<{ value: string; label: string }>;
  display_name_preferences: Array<{ value: string; label: string }>;
}
