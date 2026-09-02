"use client";

import type { AdminRole, LoginSuccess } from "./types";

const TOKEN_KEY = "ryer_admin_token";
const REFRESH_KEY = "ryer_admin_refresh";
const ACCESS_EXPIRY_KEY = "ryer_admin_access_expiry";
const ADMIN_KEY = "ryer_admin_identity";
const DEADLINE_KEY = "ryer_admin_idle_deadline";
const SESSION_END_KEY = "ryer_admin_session_end";
const IDLE_SECONDS_KEY = "ryer_admin_idle_seconds";

export interface StoredAdmin {
  id: string;
  email: string;
  login_id: string;
  role: AdminRole;
  last_login_at: string | null;
}

/**
 * Session state lives in localStorage, so closing the browser is not a sign-out.
 *
 * The idle timeout is still what ends a session, and the server owns it: it
 * revokes on its own clock whatever the browser has kept. What surviving a
 * closed window buys is that an admin who quits at lunch and comes back inside
 * the window is not made to sign in again — the reason this was moved off
 * sessionStorage. Nothing is written to a cookie either way, so a stored token
 * still cannot be replayed by a cross-site request.
 *
 * The cost is that every tab now shares one refresh token instead of holding
 * its own, and that token is single-use — two tabs spending it would look like
 * theft to the backend and revoke every session the admin has. `refreshTokens`
 * in lib/api.ts is what keeps that from happening: it takes a cross-tab lock
 * and re-reads this storage before exchanging anything.
 */
function store(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

/**
 * Write the token pair and the identity that came back with it.
 *
 * Shared by sign-in and refresh. The idle deadline is handled by each caller:
 * sign-in starts one, and a refresh slides the one already running.
 */
function saveTokens(login: LoginSuccess): void {
  const s = store();
  if (!s) return;

  s.setItem(TOKEN_KEY, login.access_token);
  s.setItem(REFRESH_KEY, login.refresh_token);
  s.setItem(ADMIN_KEY, JSON.stringify(login.admin));
  s.setItem(ACCESS_EXPIRY_KEY, String(Date.now() + login.expires_in * 1000));

  /*
   * The absolute end of the session, fixed at sign-in. `refresh_expires_in`
   * counts down to the server's `expires_at`, which a refresh copies forward
   * rather than extending — so every exchange rewrites this to the same
   * instant, and re-deriving it here is what corrects any drift in our clock.
   */
  s.setItem(
    SESSION_END_KEY,
    String(Date.now() + login.refresh_expires_in * 1000),
  );
}

export function saveSession(login: LoginSuccess): void {
  const s = store();
  if (!s) return;

  saveTokens(login);

  // The server owns the length of the idle window. Keep it alongside the
  // deadline so every later slide uses the server's number rather than a
  // constant of ours that has to be kept in step with it by hand.
  s.setItem(IDLE_SECONDS_KEY, String(login.idle_timeout_seconds));
  s.setItem(
    DEADLINE_KEY,
    String(Date.now() + login.idle_timeout_seconds * 1000),
  );
}

/**
 * Applied to a /auth/refresh response — new pair, and the idle countdown moves
 * with it.
 *
 * The server slides its own idle window on an exchange, so leaving the local
 * deadline where it was would sign an admin out of a session the API is still
 * perfectly willing to serve.
 */
export function saveRefreshedTokens(login: LoginSuccess): void {
  saveTokens(login);
  touchIdleDeadline(login.idle_timeout_seconds);
}

export function getToken(): string | null {
  return store()?.getItem(TOKEN_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return store()?.getItem(REFRESH_KEY) ?? null;
}

/**
 * True when the access token is close enough to expiry that a request sent now
 * would probably arrive after it.
 *
 * The margin covers the round trip and any clock skew between browser and
 * server. Renewing early is cheap — one extra call every fifteen minutes —
 * whereas renewing late costs a failed request and a retry on every screen the
 * admin happens to be loading at the time.
 */
export function accessTokenIsStale(marginMs = 60_000): boolean {
  const raw = store()?.getItem(ACCESS_EXPIRY_KEY);
  if (!raw) return false;

  const expiry = Number(raw);
  if (!Number.isFinite(expiry)) return false;

  return expiry - Date.now() <= marginMs;
}

export function getAdmin(): StoredAdmin | null {
  const raw = store()?.getItem(ADMIN_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredAdmin;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  const s = store();
  if (!s) return;

  s.removeItem(TOKEN_KEY);
  s.removeItem(REFRESH_KEY);
  s.removeItem(ACCESS_EXPIRY_KEY);
  s.removeItem(ADMIN_KEY);
  s.removeItem(DEADLINE_KEY);
  s.removeItem(IDLE_SECONDS_KEY);
  s.removeItem(SESSION_END_KEY);
}

/**
 * Time left on the two-hour cap, which nothing the admin does can extend.
 *
 * The idle deadline below is a soft countdown the portal renews past; this is
 * the hard one. Reading null means a session stored before this key existed —
 * treated as "no local opinion", leaving the server to end it on the next call.
 */
export function millisecondsUntilSessionEnd(): number | null {
  const raw = store()?.getItem(SESSION_END_KEY);
  if (!raw) return null;

  const end = Number(raw);
  if (!Number.isFinite(end)) return null;

  return end - Date.now();
}

/**
 * The browser's view of the idle deadline.
 *
 * This is a courtesy, not the control: the server revokes the session on its
 * own clock regardless of what this says. Its only job is to warn the admin
 * before their work is interrupted mid-form.
 */
export function idleTimeoutSeconds(): number | null {
  const raw = store()?.getItem(IDLE_SECONDS_KEY);
  const seconds = Number(raw);

  return raw && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Slide the local deadline forward by the window the server gave us at login.
 *
 * With no stored window there is nothing honest to count down to, so the
 * deadline is left alone: a guessed default here silently shortens the session
 * to whatever number happens to be in this file, which is how the portal came
 * to sign admins out after fifteen minutes while the server allowed far longer.
 */
export function touchIdleDeadline(idleSeconds = idleTimeoutSeconds()): void {
  if (!idleSeconds) return;

  store()?.setItem(DEADLINE_KEY, String(Date.now() + idleSeconds * 1000));
}

export function millisecondsUntilIdle(): number | null {
  const raw = store()?.getItem(DEADLINE_KEY);
  if (!raw) return null;

  const deadline = Number(raw);
  if (!Number.isFinite(deadline)) return null;

  return deadline - Date.now();
}

/** §8.1 role matrix, as the UI needs it. */
export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  underwriter: "Underwriter",
  funding: "Funding",
  agent: "Agent",
  read_only: "Read Only",
};

/** Everyone who may write anything at all — read_only is the viewer. */
const OPERATORS: AdminRole[] = [
  "super_admin",
  "underwriter",
  "funding",
  "agent",
];

/**
 * §8.1, mirroring src/common/roles/role-matrix.ts on the backend one capability
 * at a time — same names, same members:
 *
 *   super_admin — view, edit, request documents, approve, decline, fund,
 *                 final terms, mark called-in, resend emails, manage admin
 *                 users, reveal sensitive information
 *   underwriter — view, edit, request documents, approve, decline
 *   funding     — view, fund, final terms
 *   agent       — view, mark called-in, resend emails
 *   read_only   — view
 *
 * This decides what a screen offers, never what it permits: the guard on the
 * route is the enforcement point and re-checks every one of these. Keeping the
 * shapes identical is what stops the portal offering a button the API will
 * refuse, which is how the funding role came to see an Edit control it could
 * not use.
 */
export const ROLE_MATRIX = {
  /** "view" — listed for all five roles. read_only ends here. */
  view: [...OPERATORS, "read_only" as AdminRole],

  /** "underwriter — … edit …" — funding's line stops at fund and final terms. */
  edit: ["super_admin", "underwriter"] as AdminRole[],

  /** "underwriter — … request documents …". */
  requestDocuments: ["super_admin", "underwriter"] as AdminRole[],

  /**
   * Moving a file between intake and a decision. §8.1 names none of these
   * steps, so they follow the underwriter who owns that stretch of the file.
   */
  casework: ["super_admin", "underwriter"] as AdminRole[],

  /** "underwriter — … approve, decline". */
  decide: ["super_admin", "underwriter"] as AdminRole[],

  /** "funding — view, fund, final terms" — both halves are the Fund action. */
  fund: ["super_admin", "funding"] as AdminRole[],

  /**
   * "agent — view, mark called-in, resend emails". The agent's own two write
   * actions, granted to the agent and to super_admin and to nobody else — not
   * a floor every operator stands on.
   */
  markCalledIn: ["super_admin", "agent"] as AdminRole[],
  resendEmail: ["super_admin", "agent"] as AdminRole[],

  /**
   * Not in the §8.1 list. Notes stay with every role that may write anything,
   * because a note is the reasoning attached to an action rather than an
   * action of its own.
   */
  notes: OPERATORS,

  /** "super_admin — … reveal sensitive information", and no other line. */
  reveal: ["super_admin"] as AdminRole[],

  /** "super_admin — … manage admin users". */
  manageUsers: ["super_admin"] as AdminRole[],

  /**
   * Asking a funded borrower for a review — §11 step 1, from the §8.4 action
   * row. Follows the officer who funded the file; deciding what appears on the
   * public site is the separate capability below.
   */
  sendReviewInvitation: ["super_admin", "funding"] as AdminRole[],

  /**
   * Publishing or burying a borrower review on the public site. Not in §8.1,
   * so it is read as denied unless granted: marketing copy going out under the
   * lender's name sits with the state lending rules, at super_admin. Listing
   * the queue is a view and stays open to every role.
   */
  moderateReviews: ["super_admin"] as AdminRole[],
} satisfies Record<string, AdminRole[]>;

export type Capability = keyof typeof ROLE_MATRIX;

function allows(capability: Capability, role?: AdminRole): boolean {
  return Boolean(role && ROLE_MATRIX[capability].includes(role));
}

export const can = {
  view: (role?: AdminRole) => allows("view", role),
  edit: (role?: AdminRole) => allows("edit", role),
  requestDocuments: (role?: AdminRole) => allows("requestDocuments", role),
  casework: (role?: AdminRole) => allows("casework", role),
  decide: (role?: AdminRole) => allows("decide", role),
  fund: (role?: AdminRole) => allows("fund", role),
  sendReviewInvitation: (role?: AdminRole) =>
    allows("sendReviewInvitation", role),
  markCalledIn: (role?: AdminRole) => allows("markCalledIn", role),
  resendEmail: (role?: AdminRole) => allows("resendEmail", role),
  notes: (role?: AdminRole) => allows("notes", role),
  reveal: (role?: AdminRole) => allows("reveal", role),
  manageUsers: (role?: AdminRole) => allows("manageUsers", role),
  moderateReviews: (role?: AdminRole) => allows("moderateReviews", role),

  /**
   * §8.4: SSN and bank account edits need super_admin on top of `edit`. A
   * field-level rule rather than a role capability, so it sits outside the
   * matrix.
   */
  editSensitive: (role?: AdminRole) => role === "super_admin",
};
