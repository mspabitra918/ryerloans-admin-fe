"use client";

import {
  accessTokenIsStale,
  clearSession,
  getRefreshToken,
  getToken,
  saveRefreshedTokens,
  touchIdleDeadline,
} from "./auth";
import type {
  ActionResult,
  AdminActionBody,
  AdminIdentity,
  AdminUserView,
  ApplicationDetail,
  DashboardStats,
  FilterOptions,
  LoginChallenge,
  LoginSuccess,
  NoteView,
  ReviewFilter,
  ReviewModerationOptions,
  ReviewModerationView,
  SearchResponse,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** True when the server ended the session rather than refusing one request. */
  get isSessionEnded(): boolean {
    return this.status === 401;
  }
}

/**
 * The one refresh call allowed to be in flight at a time.
 *
 * Refresh tokens are single use: the backend rotates on every exchange and
 * treats a second presentation of a spent token as theft, revoking every
 * session the admin has. A dashboard that fires six requests at once and lets
 * each of them notice the expired access token would do exactly that to
 * itself, so every caller waits on the same promise instead.
 */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * Why a refresh did not produce a new pair.
 *
 * `refused` is the server having ended the session and is the only outcome
 * that justifies signing an admin out. `unreachable` is a dropped connection,
 * which says nothing about the session and must not cost one.
 */
export type RefreshOutcome = "renewed" | "refused" | "unreachable";

/**
 * The cross-tab half of the same guarantee.
 *
 * Tokens live in localStorage, so every tab of the portal shares one refresh
 * token rather than holding its own. `refreshInFlight` only serialises the
 * callers inside a single tab; two tabs reaching their idle deadline together
 * would still present the same spent token and cost the admin every session
 * they have. Web Locks serialise them across the origin instead.
 */
const REFRESH_LOCK = "ryer_admin_refresh_lock";

async function exchange(refreshToken: string): Promise<RefreshOutcome> {
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });

    // A 5xx is the API having a bad moment, not a verdict on this session.
    if (!response.ok) {
      return response.status >= 500 ? "unreachable" : "refused";
    }

    saveRefreshedTokens((await response.json()) as LoginSuccess);

    return "renewed";
  } catch {
    // A network failure is not an ended session. Report it as a failed
    // refresh and let the caller's own error path say so — clearing the
    // session here would sign an admin out because their wifi dropped.
    return "unreachable";
  }
}

async function runRefresh(): Promise<RefreshOutcome> {
  const held = getRefreshToken();

  // Nothing to exchange — a pre-refresh session, or one already torn down.
  if (!held) return "refused";

  // Web Locks is missing on older Safari; there the in-tab guard is all there
  // is, which is no worse than the per-tab storage this replaced.
  if (typeof navigator === "undefined" || !navigator.locks) {
    return exchange(held);
  }

  return navigator.locks.request(REFRESH_LOCK, async () => {
    const current = getRefreshToken();

    // Cleared while we queued — the session ended in another tab.
    if (!current) return "refused";

    /*
     * Another tab rotated ahead of us and its new pair is already in storage,
     * so there is nothing left to exchange: presenting the token we queued
     * with is precisely the replay the lock exists to prevent.
     */
    if (current !== held) return "renewed";

    return exchange(current);
  });
}

function refreshTokens(): Promise<RefreshOutcome> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * Renew before sending rather than after being refused.
 *
 * The reactive path below still exists — clock skew and a restarted server
 * both produce a 401 no local expiry predicts — but going through it on every
 * screen would double the request count for a quarter of the portal's traffic.
 */
async function ensureFreshAccessToken(): Promise<void> {
  if (!getRefreshToken() || !accessTokenIsStale()) return;

  await refreshTokens();
}

/**
 * Send an authenticated request, renewing the token pair around it.
 *
 * The token is read inside `send` rather than captured once, so the retry
 * picks up whatever the refresh just stored instead of replaying the token
 * that was already refused.
 */
async function authorizedFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  await ensureFreshAccessToken();

  const send = (): Promise<Response> => {
    const token = getToken();

    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Borrower data must never come from a cache; a stale status on this
      // screen is what leads to a duplicate email or a second disbursement.
      cache: "no-store",
    });
  };

  const response = await send();

  if (response.status !== 401) return response;

  /*
   * A 401 is either an expired access token or a session the server has ended
   * — idle timeout, IP mismatch, a rotated password. Only the first is
   * recoverable, and the refresh call is what tells the two apart: it succeeds
   * for a live session and fails for a dead one.
   */
  if ((await refreshTokens()) !== "renewed") return response;

  return send();
}

/** The session is over; stop retrying and send the admin back to sign in. */
function endSession(message: string): void {
  clearSession();

  if (typeof window === "undefined") return;

  const reason = /timed out/i.test(message) ? "timeout" : "expired";
  window.location.href = `/login?session=${reason}`;
}

async function request<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean },
): Promise<T> {
  const { skipAuth = false, ...rest } = init ?? {};

  const headers = {
    "Content-Type": "application/json",
    ...(rest.headers ?? {}),
  };

  const response = skipAuth
    ? await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers,
        cache: "no-store",
      })
    : await authorizedFetch(path, { ...rest, headers });

  if (!response.ok) {
    const message = await extractError(response);

    /*
     * Reaching here with a 401 means the refresh above was tried and failed,
     * so the session really is gone. Clearing keeps the client from looping on
     * credentials the server will never accept again.
     */
    if (response.status === 401 && !skipAuth) endSession(message);

    throw new ApiError(message, response.status);
  }

  // Any successful authenticated call is activity, so the local idle countdown
  // slides forward with the server's.
  if (!skipAuth && getToken()) touchIdleDeadline();

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

async function extractError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };

    if (body?.message) {
      return Array.isArray(body.message)
        ? body.message.join(", ")
        : body.message;
    }
  } catch {
    /* non-JSON error body — fall through to the generic message */
  }

  return `Request failed (${response.status})`;
}

/**
 * Binary sibling of `request` — same auth and same error handling, but the
 * body comes back as a blob and the filename off the Content-Disposition
 * header the API sets.
 */
async function download(
  path: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await authorizedFetch(path, {});

  if (!response.ok) {
    const message = await extractError(response);

    if (response.status === 401) endSession(message);

    throw new ApiError(message, response.status);
  }

  touchIdleDeadline();

  return {
    blob: await response.blob(),
    filename: filenameFrom(response.headers.get("Content-Disposition")),
  };
}

/**
 * Prefer the RFC 5987 `filename*` form: the plain `filename=` beside it has
 * had every non-ASCII character replaced, so trusting it first would save a
 * borrower's document under a name full of underscores.
 */
function filenameFrom(header: string | null): string {
  if (!header) return "document";

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);

  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      /* malformed encoding — fall through to the plain parameter */
    }
  }

  return /filename="([^"]+)"/i.exec(header)?.[1] ?? "document";
}

function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;

    // Array filters are sent comma-separated, which the backend DTO accepts.
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }

  const serialized = search.toString();

  return serialized ? `?${serialized}` : "";
}

export const api = {
  /* ------------------------------------------------------------- §8.1 auth */

  login(identifier: string, password: string): Promise<LoginChallenge> {
    return request<LoginChallenge>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
      skipAuth: true,
    });
  },

  verifyMfa(challengeToken: string, code: string): Promise<LoginSuccess> {
    return request<LoginSuccess>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ challenge_token: challengeToken, code }),
      skipAuth: true,
    });
  },

  enrollMfa(challengeToken: string, code: string): Promise<LoginSuccess> {
    return request<LoginSuccess>("/auth/mfa/enroll", {
      method: "POST",
      body: JSON.stringify({ challenge_token: challengeToken, code }),
      skipAuth: true,
    });
  },

  me(): Promise<{ admin: AdminIdentity }> {
    return request("/auth/me");
  },

  logout(): Promise<{ success: true }> {
    return request("/auth/logout", { method: "POST" });
  },

  /**
   * Renew the token pair without sending a real request.
   *
   * The session shell calls this when the local idle countdown runs out: a tab
   * nobody has touched sends nothing, so there is no 401 to renew off, and the
   * countdown is the only thing that would otherwise end the session. Shares
   * the single-flight guard above, so it can never race the request path into
   * spending the same single-use token twice. `false` means the server refused
   * — the absolute cap, a revoked session, a changed IP — and the caller
   * should sign the admin out. `"unreachable"` is a dropped connection and
   * must not be treated as one.
   */
  renewSession(): Promise<RefreshOutcome> {
    return refreshTokens();
  },

  changePassword(current: string, next: string): Promise<{ success: true }> {
    return request("/auth/password", {
      method: "POST",
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
  },

  /* -------------------------------------------------------- §8.5 dashboard */

  dashboard(range: string): Promise<DashboardStats> {
    return request(`/admin/dashboard${query({ range })}`);
  },

  /* ----------------------------------------------------------- §8.2 search */

  search(params: Record<string, unknown>): Promise<SearchResponse> {
    return request(`/admin/applications${query(params)}`);
  },

  filters(): Promise<FilterOptions> {
    return request("/admin/applications/filters");
  },

  /* ----------------------------------------------------------- §8.3 detail */

  detail(applicationId: string): Promise<ApplicationDetail> {
    return request(`/admin/applications/${applicationId}`);
  },

  reveal(
    applicationId: string,
    field: string,
    password: string,
    reason?: string,
  ): Promise<{ field: string; value: string }> {
    return request(`/admin/applications/${applicationId}/reveal`, {
      method: "POST",
      body: JSON.stringify({ field, password, reason }),
    });
  },

  addNote(applicationId: string, body: string): Promise<NoteView> {
    return request(`/admin/applications/${applicationId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  },

  assignAgent(
    applicationId: string,
    adminUserId: string | null,
  ): Promise<{ assigned_agent_id: string | null }> {
    return request(`/admin/applications/${applicationId}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ admin_user_id: adminUserId ?? undefined }),
    });
  },

  /**
   * §8.4 Edit Application. `borrower_visible_change` says whether an email was
   * owed and `email_sent` whether one actually went out — a suppressed address
   * makes the two differ, and the UI has to be able to tell them apart.
   */
  editApplication(
    applicationId: string,
    payload: AdminActionBody & {
      changes: Record<string, unknown>;
      password?: string;
    },
  ): Promise<
    ActionResult & {
      changed_fields: string[];
      borrower_visible_change: boolean;
    }
  > {
    return request(`/admin/applications/${applicationId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  /**
   * `resent` is false when the address is suppressed — the request succeeded,
   * the borrower simply did not get mail. Templates that cannot be rebuilt are
   * rejected with a 400 instead.
   */
  resendEmail(
    applicationId: string,
    emailLogId: string,
  ): Promise<{ resent: boolean; template_key: string; reason?: string }> {
    return request(`/admin/applications/${applicationId}/resend-email`, {
      method: "POST",
      body: JSON.stringify({ email_log_id: emailLogId }),
    });
  },

  /* -------------------------------------------------------- §8.3 documents */

  /**
   * Fetch one uploaded document as a blob.
   *
   * Not a plain link, because the route is behind the §8.1 admin session and a
   * browser navigation cannot carry the bearer token. Fetching it here and
   * saving the blob keeps the session as the only thing that opens a
   * borrower's file — there is no URL to leak.
   */
  documentBlob(documentId: string): Promise<{ blob: Blob; filename: string }> {
    return download(`/admin/documents/${documentId}/download`);
  },

  /* ---------------------------------------------------------- §8.4 actions */

  /**
   * Every action button posts the same envelope, so they share one call. The
   * per-action extras (terms, reason codes, funded amount) ride along in
   * `payload`.
   */
  action<T = ActionResult>(
    applicationId: string,
    action: string,
    payload: AdminActionBody & Record<string, unknown> = {},
    method: "PATCH" | "POST" = "PATCH",
  ): Promise<T> {
    return request<T>(`/admin/applications/${applicationId}/${action}`, {
      method,
      body: JSON.stringify(payload),
    });
  },

  /* ---------------------------------------------------------- §11 reviews */

  /**
   * The moderation queue. Listing is a `view`, so every role reaches it; only
   * the decision below is restricted to super_admin, both here and at the
   * route guard.
   */
  reviews(
    filter: ReviewFilter = "pending",
  ): Promise<{ rows: ReviewModerationView[]; count: number }> {
    return request(`/reviews/admin/pending?status=${filter}`);
  },

  reviewOptions(): Promise<ReviewModerationOptions> {
    return request("/reviews/admin/options");
  },

  /**
   * Publish or reject. There is no third option and no way to edit the text —
   * §11 forbids altering a review, so the API offers no field for it.
   */
  moderateReview(
    id: string,
    payload: { approve: boolean; reason?: string },
  ): Promise<{
    id: string;
    is_published: boolean;
    moderated_at: string | null;
    moderation_reason: string | null;
  }> {
    return request(`/reviews/admin/${id}/moderate`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  /* ------------------------------------------------------ §8.1 user admin */

  users(): Promise<{ users: AdminUserView[] }> {
    return request("/admin/users");
  },

  createUser(payload: {
    email: string;
    password: string;
    role: string;
    /** Omitted lets the backend generate one. */
    login_id?: string;
  }): Promise<{ user: AdminUserView }> {
    return request("/admin/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateUser(
    id: string,
    payload: { role?: string; is_active?: boolean },
  ): Promise<{ user: AdminUserView }> {
    return request(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  unlockUser(id: string): Promise<{ user: AdminUserView }> {
    return request(`/admin/users/${id}/unlock`, { method: "PATCH" });
  },

  resetUserMfa(id: string): Promise<{ user: AdminUserView }> {
    return request(`/admin/users/${id}/mfa/reset`, { method: "PATCH" });
  },

  resetUserPassword(
    id: string,
    password: string,
  ): Promise<{ user: AdminUserView }> {
    return request(`/admin/users/${id}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    });
  },
};
