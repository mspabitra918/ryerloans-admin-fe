"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { api } from "@/lib/api";
import {
  accessTokenIsStale,
  clearSession,
  getAdmin,
  getToken,
  millisecondsUntilIdle,
  millisecondsUntilSessionEnd,
  type StoredAdmin,
} from "@/lib/auth";

interface SessionContextValue {
  admin: StoredAdmin | null;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  admin: null,
  signOut: async () => {},
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

/**
 * Renew this long before the idle deadline rather than after it.
 *
 * Crossing the deadline and then renewing would be a race against the server's
 * own clock, which is the one comparison a little skew is enough to lose.
 */
const RENEW_AT_MS = 60_000;
const TICK_MS = 15_000;

/**
 * Client-side session shell.
 *
 * The authority on session validity is the API — it revokes on absolute
 * expiry, IP mismatch and password change, and any request will come back 401.
 * This only does two things the server cannot: keep an unauthenticated tab off
 * the portal chrome entirely, and keep an idle-but-open tab signed in by
 * renewing the token pair on its own, since a tab nobody touches sends no
 * request for the reactive path in `api` to renew off.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<StoredAdmin | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Already-revoked sessions 401 here, which is the outcome we wanted.
    } finally {
      clearSession();
      router.replace("/login");
    }
  }, [router]);

  // Session state lives in localStorage, so it is only readable after mount.
  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    // Reopened past the cap — the stored token is already dead server-side.
    const sessionLeft = millisecondsUntilSessionEnd();

    if (sessionLeft !== null && sessionLeft <= 0) {
      clearSession();
      router.replace("/login?session=expired");
      return;
    }

    setAdmin(getAdmin());
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;

    /** Sign out on the absolute cap, whoever noticed it first. */
    const endSession = () => {
      toast.warning("Session ended", {
        description: "Please sign in again to continue.",
      });

      clearSession();
      router.replace("/login?session=expired");
    };

    const interval = window.setInterval(() => {
      /*
       * The two-hour cap is absolute and no refresh moves it, so once it has
       * passed there is nothing to renew — an admin left on a dead session
       * would otherwise sit on portal chrome until their next click 401ed.
       */
      const sessionLeft = millisecondsUntilSessionEnd();

      if (sessionLeft !== null && sessionLeft <= 0) {
        endSession();
        return;
      }

      const remaining = millisecondsUntilIdle();

      /*
       * Two reasons to renew, and a tab nobody touches only ever hits the
       * first. `ensureFreshAccessToken` covers the access token for tabs that
       * are being used, but it runs inside a request — so without this an idle
       * tab sits on a token that died at the fifteen-minute mark and does not
       * notice until its next click. Renewing here keeps the pair live for as
       * long as the cap allows, and makes that next click immediate rather
       * than a refresh round trip followed by the real request.
       */
      const stale = accessTokenIsStale();
      const idleDue = remaining !== null && remaining <= RENEW_AT_MS;

      if (!stale && !idleDue) return;

      /*
       * The idle window is up, so renew rather than sign out. A refresh that
       * succeeds slides both clocks and the admin never sees this happen; one
       * that fails means the server has genuinely ended the session — the
       * two-hour absolute cap, a changed IP, a revoked account — and that is
       * the only case that still sends anyone back to the sign-in page. A
       * refresh that could not reach the API is left to the next tick; an
       * admin whose wifi blinked has not ended their session.
       */
      void api.renewSession().then((outcome) => {
        if (cancelled || outcome !== "refused") return;

        endSession();
      });
    }, TICK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [ready, router]);

  const value = useMemo(() => ({ admin, signOut }), [admin, signOut]);

  // Rendering the portal before the token check would flash borrower data
  // shells at someone who is about to be redirected to the sign-in page.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--foreground-muted)]">
        Loading…
      </div>
    );
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
