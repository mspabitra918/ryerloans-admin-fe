"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, Smartphone } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { getToken, saveSession } from "@/lib/auth";
import type { LoginChallenge } from "@/lib/types";

type Stage = "credentials" | "verify" | "enroll";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [stage, setStage] = useState<Stage>("credentials");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);

  /*
   * An admin who already has a session should never be asked to sign in again.
   * The token lives in localStorage, so it is only readable after mount —
   * which is why this gates rendering on `checked` rather than just firing a
   * redirect: without the gate the sign-in form paints for a frame before the
   * router moves, and it reads as "it logged me out".
   */
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard");
      return;
    }

    setChecked(true);
  }, [router]);

  // Tell the admin why they landed back here, rather than leaving them to
  // wonder whether they were signed out or something broke.
  useEffect(() => {
    const reason = params.get("session");
    if (reason === "timeout") {
      setError("Your session timed out after a period of inactivity.");
    } else if (reason === "expired") {
      // Naming the cap matters: an admin cut off mid-file otherwise reads a
      // bare "session ended" as the portal having broken on them.
      setError("Your session reached its two-hour limit. Please sign in again.");
    }
  }, [params]);

  useEffect(() => {
    if (stage !== "credentials") codeRef.current?.focus();
  }, [stage]);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await api.login(identifier.trim(), password);

      setChallenge(result);
      setStage(result.mfa_stage === "enroll" ? "enroll" : "verify");
      // The password has done its job; nothing is served by keeping it in
      // component state through the second factor.
      setPassword("");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Unable to sign in.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge) return;

    setBusy(true);
    setError(null);

    try {
      const login =
        stage === "enroll"
          ? await api.enrollMfa(challenge.challenge_token, code)
          : await api.verifyMfa(challenge.challenge_token, code);

      saveSession(login);
      toast.success(`Signed in as ${login.admin.email}`);
      router.replace("/dashboard");
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.message : "Verification failed.";

      setError(message);
      setCode("");

      // An expired challenge cannot be retried — send them back to step one
      // rather than letting them type codes into a dead token.
      if (/challenge|start again/i.test(message)) {
        setStage("credentials");
        setChallenge(null);
      }
    } finally {
      setBusy(false);
    }
  }

  // Still resolving whether there is a session, or already on the way to the
  // dashboard. Either way, showing the sign-in form here would be a lie.
  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-[var(--foreground-muted)]">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
            <ShieldCheck size={24} aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Ryer Loans Admin
          </h1>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">
            Authorised personnel only. All activity is logged.
          </p>
        </div>

        <div className="card p-6 shadow-sm">
          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200"
            >
              {error}
            </p>
          ) : null}

          {stage === "credentials" ? (
            <form onSubmit={submitCredentials} className="space-y-4">
              <div>
                <label
                  htmlFor="identifier"
                  className="mb-1 block text-sm font-medium"
                >
                  Email or login code
                </label>
                <input
                  id="identifier"
                  className="field"
                  autoComplete="username"
                  autoFocus
                  required
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="you@ryerloans.com"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-medium"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="field"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={busy}
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden />
                ) : (
                  <KeyRound size={16} aria-hidden />
                )}
                Continue
              </button>

              <p className="text-center text-xs text-[var(--foreground-muted)]">
                Five failed attempts lock the account for 15 minutes.
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              {stage === "enroll" && challenge?.enrollment ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-lg bg-[var(--accent-soft)] p-3 text-sm">
                    <Smartphone
                      size={16}
                      className="mt-0.5 shrink-0"
                      aria-hidden
                    />
                    <p>
                      Two-factor authentication is required. Scan this code with
                      your authenticator app, then enter the 6-digit code it
                      shows.
                    </p>
                  </div>

                  <div className="flex justify-center">
                    <Image
                      src={challenge.enrollment.qr_data_url}
                      alt="TOTP enrollment QR code"
                      width={192}
                      height={192}
                      unoptimized
                      className="rounded-lg border border-[var(--border)] bg-white p-2"
                    />
                  </div>

                  <details className="text-xs text-[var(--foreground-muted)]">
                    <summary className="cursor-pointer">
                      Can&apos;t scan? Enter the key manually
                    </summary>
                    <code className="mt-2 block break-all rounded bg-[var(--surface-muted)] p-2 font-mono">
                      {challenge.enrollment.secret}
                    </code>
                  </details>
                </div>
              ) : (
                <p className="text-sm text-[var(--foreground-muted)]">
                  Enter the 6-digit code from your authenticator app.
                </p>
              )}

              <div>
                <label
                  htmlFor="code"
                  className="mb-1 block text-sm font-medium"
                >
                  Authentication code
                </label>
                <input
                  id="code"
                  ref={codeRef}
                  className="field text-center font-mono text-lg tracking-[0.5em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={busy || code.length !== 6}
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck size={16} aria-hidden />
                )}
                {stage === "enroll" ? "Confirm and sign in" : "Verify"}
              </button>

              <button
                type="button"
                className="btn btn-secondary w-full"
                onClick={() => {
                  setStage("credentials");
                  setChallenge(null);
                  setCode("");
                  setError(null);
                }}
              >
                Start over
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary to keep the route static-safe.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
