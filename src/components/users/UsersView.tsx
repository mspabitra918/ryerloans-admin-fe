"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  KeyRound,
  Loader2,
  LockOpen,
  Plus,
  ShieldOff,
  Smartphone,
  UserCheck,
  UserX,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { can, ROLE_LABELS } from "@/lib/auth";
import { useSession } from "@/components/shell/SessionProvider";
import { when } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import type { AdminRole, AdminUserView } from "@/lib/types";

/** §8.1, most privileged first. */
const ROLES: AdminRole[] = [
  "super_admin",
  "underwriter",
  "funding",
  "agent",
  "read_only",
];

/**
 * The §8.1 matrix in prose, shown wherever a role is being chosen.
 *
 * Which role someone gets is the one decision on this page that fails quietly:
 * too little and their work stalls, too much and they can reveal borrower SSNs.
 * Spelling the grant out beside the control beats trusting that whoever is
 * clicking remembers the spec.
 */
const ROLE_SUMMARY: Record<AdminRole, string> = {
  super_admin: "Everything, plus admin user management.",
  underwriter: "View, edit, request documents, approve and decline.",
  funding: "View, fund, and set final terms.",
  agent:
    "View, mark called in, resend emails. Cannot reveal SSN or account numbers.",
  read_only: "View only.",
};

const ROLE_TONE: Record<AdminRole, string> = {
  super_admin: "bg-indigo-100 text-indigo-800 ring-indigo-300",
  underwriter: "bg-sky-100 text-sky-800 ring-sky-300",
  funding: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  agent: "bg-amber-100 text-amber-800 ring-amber-300",
  read_only: "bg-slate-100 text-slate-700 ring-slate-300",
};

/** The backend requires 12 characters; nothing here should sit at the floor. */
const PASSWORD_LENGTH = 20;

function generatePassword(): string {
  // Ambiguous glyphs are omitted: these get read aloud and typed by hand.
  const alphabet =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_";
  const values = new Uint32Array(PASSWORD_LENGTH);
  crypto.getRandomValues(values);

  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
}

function isLocked(user: AdminUserView): boolean {
  return Boolean(
    user.locked_until && new Date(user.locked_until).getTime() > Date.now(),
  );
}

interface Confirmation {
  title: string;
  body: string;
  confirmLabel: string;
  success: string;
  danger?: boolean;
  userId: string;
  run: () => Promise<unknown>;
  /** Credentials to hand over once the call succeeds. */
  reveals?: { email: string; password: string };
}

interface Credentials {
  email: string;
  loginId?: string;
  password: string;
}

export function UsersView() {
  const { admin } = useSession();
  const permitted = can.manageUsers(admin?.role);

  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  // SessionProvider withholds its children until the identity is read, so the
  // role is settled by first render and there is nothing to load without it.
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setUsers((await api.users()).users);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load admin users.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permitted) void load();
  }, [permitted, load]);

  const activeSuperAdmins = useMemo(
    () =>
      (users ?? []).filter(
        (user) => user.is_active && user.role === "super_admin",
      ).length,
    [users],
  );

  /**
   * Why a row's role and access controls are locked, if they are.
   *
   * Both cases end the same way — nobody can reach user management — and the
   * API has no guard against either, so the portal has to refuse before the
   * request is sent rather than explain afterwards.
   */
  function restriction(user: AdminUserView): string | null {
    if (user.id === admin?.id) {
      return "You cannot change your own role or access.";
    }

    if (
      user.role === "super_admin" &&
      user.is_active &&
      activeSuperAdmins <= 1
    ) {
      return "This is the last active Super Admin. Promote someone else first.";
    }

    return null;
  }

  async function run(
    userId: string,
    success: string,
    call: () => Promise<unknown>,
  ): Promise<boolean> {
    setBusyId(userId);

    try {
      await call();
      toast.success(success);
      await load();
      return true;
    } catch (caught) {
      toast.error(
        caught instanceof ApiError
          ? caught.message
          : "Could not apply that change.",
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function confirmNow() {
    if (!confirmation) return;

    const done = await run(
      confirmation.userId,
      confirmation.success,
      confirmation.run,
    );

    if (done && confirmation.reveals) setCredentials(confirmation.reveals);
    if (done) setConfirmation(null);
  }

  function resetPassword(user: AdminUserView) {
    const password = generatePassword();

    setConfirmation({
      userId: user.id,
      title: "Reset password",
      body: `A new password will be generated for ${user.email} and shown to you once. Their active sessions end immediately and any lockout is cleared.`,
      confirmLabel: "Reset password",
      success: "Password reset",
      run: () => api.resetUserPassword(user.id, password),
      reveals: { email: user.email, password },
    });
  }

  if (!permitted) {
    return (
      <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
        <ShieldOff
          size={22}
          className="text-[var(--foreground-muted)]"
          aria-hidden
        />
        <h1 className="text-base font-semibold">Admin users</h1>
        <p className="max-w-md text-sm text-[var(--foreground-muted)]">
          Only a Super Admin manages portal accounts. The API refuses these
          requests for every other role, so this page has nothing to show you.
        </p>
      </div>
    );
  }

  if (loading && !users) return <Spinner label="Loading admin users…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Admin users</h1>
          <p className="text-sm text-[var(--foreground-muted)]">
            Portal accounts and the §8.1 role each one holds.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreating(true)}
        >
          <Plus size={15} aria-hidden />
          Add admin user
        </button>
      </header>

      {!users?.length ? (
        <div className="card">
          <EmptyState message="No admin users yet." />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--foreground-muted)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Admin</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">MFA</th>
                <th className="px-4 py-2.5 font-medium">Access</th>
                <th className="px-4 py-2.5 font-medium">Last sign-in</th>
                <th className="px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const locked = isLocked(user);
                const blocked = restriction(user);
                const busy = busyId === user.id;

                return (
                  <tr
                    key={user.id}
                    className={`border-t border-[var(--border)] ${
                      user.is_active ? "" : "opacity-60"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="truncate" title={user.email}>
                          {user.email}
                        </span>
                        {user.id === admin?.id ? (
                          <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] font-normal text-[var(--foreground-muted)]">
                            You
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="tabular block font-mono text-xs text-[var(--foreground-muted)]"
                        title={`Created ${when(user.created_at)}`}
                      >
                        {user.login_id}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      {blocked ? (
                        <span
                          title={blocked}
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${ROLE_TONE[user.role]}`}
                        >
                          {ROLE_LABELS[user.role]}
                        </span>
                      ) : (
                        <select
                          className="field min-w-40"
                          value={user.role}
                          disabled={busy}
                          aria-label={`Role for ${user.email}`}
                          onChange={(event) =>
                            void run(
                              user.id,
                              `${user.email} is now ${ROLE_LABELS[event.target.value as AdminRole]}`,
                              () =>
                                api.updateUser(user.id, {
                                  role: event.target.value,
                                }),
                            )
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      )}
                      <span className="mt-1 block max-w-64 text-xs text-[var(--foreground-muted)]">
                        {ROLE_SUMMARY[user.role]}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      {user.mfa_enabled ? (
                        <span className="text-xs text-emerald-700">
                          Enrolled
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700">
                          Enrols at next sign-in
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {!user.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-400">
                          Deactivated
                        </span>
                      ) : locked ? (
                        <span
                          title={`Locked until ${when(user.locked_until)}`}
                          className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-300"
                        >
                          Locked out
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-300">
                          Active
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span className="block text-xs">
                        {when(user.last_login_at)}
                      </span>
                      <span className="tabular block font-mono text-xs text-[var(--foreground-muted)]">
                        {user.last_login_ip ?? "—"}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {busy ? (
                          <Loader2
                            size={14}
                            className="animate-spin text-[var(--foreground-muted)]"
                            aria-hidden
                          />
                        ) : null}

                        {locked ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(user.id, "Lockout cleared", () =>
                                api.unlockUser(user.id),
                              )
                            }
                          >
                            <LockOpen size={14} aria-hidden />
                            Unlock
                          </button>
                        ) : null}

                        {/* <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => resetPassword(user)}
                        >
                          <KeyRound size={14} aria-hidden />
                          Reset password
                        </button> */}

                        {user.mfa_enabled ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              setConfirmation({
                                userId: user.id,
                                title: "Reset MFA",
                                body: `${user.email} will be signed out and asked to enrol a new authenticator at their next sign-in. Use this when they have lost their device.`,
                                confirmLabel: "Reset MFA",
                                success: "MFA reset",
                                run: () => api.resetUserMfa(user.id),
                              })
                            }
                          >
                            <Smartphone size={14} aria-hidden />
                            Reset MFA
                          </button>
                        ) : null}

                        {user.is_active ? (
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={busy || Boolean(blocked)}
                            title={blocked ?? undefined}
                            onClick={() =>
                              setConfirmation({
                                userId: user.id,
                                title: "Deactivate admin user",
                                body: `${user.email} will be signed out immediately and refused at sign-in. Their audit history is kept.`,
                                confirmLabel: "Deactivate",
                                success: "Admin user deactivated",
                                danger: true,
                                run: () =>
                                  api.updateUser(user.id, { is_active: false }),
                              })
                            }
                          >
                            <UserX size={14} aria-hidden />
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(user.id, "Admin user reactivated", () =>
                                api.updateUser(user.id, { is_active: true }),
                              )
                            }
                          >
                            <UserCheck size={14} aria-hidden />
                            Reactivate
                          </button>
                        )}
                      </div>

                      {blocked ? (
                        <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                          {blocked}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={async (issued) => {
            setCreating(false);
            setCredentials(issued);
            await load();
          }}
        />
      ) : null}

      <Modal
        open={Boolean(confirmation)}
        title={confirmation?.title ?? ""}
        onClose={() => setConfirmation(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`btn ${confirmation?.danger ? "btn-danger" : "btn-primary"}`}
              disabled={Boolean(busyId)}
              onClick={() => void confirmNow()}
            >
              {confirmation?.confirmLabel}
            </button>
          </>
        }
      >
        <p className="text-sm">{confirmation?.body}</p>
      </Modal>

      {credentials ? (
        <CredentialsModal
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ create */

/** Mounted only while open — every field, including the password, starts fresh. */
function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (credentials: Credentials) => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState("");
  const [role, setRole] = useState<AdminRole>("agent");
  const [password, setPassword] = useState(generatePassword);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      const { user } = await api.createUser({
        email: email.trim().toLowerCase(),
        password,
        role,
        ...(loginId.trim() ? { login_id: loginId.trim() } : {}),
      });

      toast.success(`${user.email} added as ${ROLE_LABELS[user.role]}`);
      await onCreated({
        email: user.email,
        loginId: user.login_id,
        password,
      });
    } catch (caught) {
      toast.error(
        caught instanceof ApiError
          ? caught.message
          : "Could not create the admin user.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Add admin user"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-admin-user"
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : null}
            Create user
          </button>
        </>
      }
    >
      <form id="create-admin-user" onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--foreground-muted)]">
            Work email
          </span>
          <input
            type="email"
            required
            autoComplete="off"
            className="field w-full"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {/* <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--foreground-muted)]">
            Login ID (optional)
          </span>
          <input
            type="text"
            minLength={6}
            maxLength={50}
            autoComplete="off"
            placeholder="Generated if left blank"
            className="field tabular w-full font-mono"
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
          />
        </label> */}

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[var(--foreground-muted)]">
            Role
          </span>
          <select
            className="field w-full"
            value={role}
            onChange={(event) => setRole(event.target.value as AdminRole)}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--foreground-muted)]">
            {ROLE_SUMMARY[role]}
          </span>
        </label>

        <div className="text-sm">
          <span className="mb-1 block text-xs text-[var(--foreground-muted)]">
            Temporary password
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              required
              minLength={12}
              readOnly
              aria-label="Temporary password"
              className="field tabular w-full font-mono"
              value={password}
            />
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => setPassword(generatePassword())}
            >
              Regenerate
            </button>
          </div>
          <span className="mt-1 block text-xs text-[var(--foreground-muted)]">
            Shown once after the account is created. They enrol an authenticator
            on their first sign-in.
          </span>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------- credential handover */

function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: Credentials;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const lines = [
      `Portal: ${credentials.email}`,
      ...(credentials.loginId ? [`Login ID: ${credentials.loginId}`] : []),
      `Password: ${credentials.password}`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
    } catch {
      toast.error("Copy failed — select the password and copy it by hand.");
    }
  }

  return (
    <Modal
      open
      title="Credentials — shown once"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="text-sm">
        The password is not stored in readable form and cannot be shown again.
        Send it over a channel the recipient controls, and have them change it
        after signing in.
      </p>

      <dl className="mt-4 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-xs text-[var(--foreground-muted)]">Email</dt>
          <dd className="min-w-0 truncate">{credentials.email}</dd>
        </div>
        {credentials.loginId ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-[var(--foreground-muted)]">Login ID</dt>
            <dd className="tabular font-mono">{credentials.loginId}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-xs text-[var(--foreground-muted)]">Password</dt>
          <dd className="tabular min-w-0 break-all text-right font-mono">
            {credentials.password}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        className="btn btn-secondary mt-3"
        onClick={() => void copy()}
      >
        <Copy size={14} aria-hidden />
        {copied ? "Copied" : "Copy credentials"}
      </button>
    </Modal>
  );
}
