"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { User } from "@/entities/user";
import { ApiError } from "@/shared/api";
import { errorMessage, getSessionToken, setSessionToken, subscribeSessionToken } from "@/shared/lib";
import { fetchMe, login, logout, signup, type Credentials } from "../api/auth";

export type AuthMode = "login" | "signup";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "signed-in"; user: User };

interface Verified {
  token: string;
  attempt: number;
  user?: User;
  error?: string;
}

/**
 * Session lifecycle. The stored token is the source of truth: any 401 clears it (see apiRequest),
 * which flips this hook to "signed-out" everywhere, including other tabs.
 */
export function useAuth() {
  // undefined during SSR and hydration, so the server never renders the sign-in form.
  const token = useSyncExternalStore(subscribeSessionToken, getSessionToken, () => undefined);
  const [attempt, setAttempt] = useState(0);
  const [verified, setVerified] = useState<Verified>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchMe().then(
      ({ user }) => {
        if (!cancelled) setVerified({ token, attempt, user });
      },
      (err) => {
        // A 401 has already cleared the token; anything else (server down) is shown with a retry.
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) {
          setVerified({ token, attempt, error: errorMessage(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const signIn = useCallback(async (mode: AuthMode, credentials: Credentials) => {
    const res = await (mode === "signup" ? signup : login)(credentials);
    // Known user up front, so the workspace shows without waiting for /auth/me.
    setVerified({ token: res.token, attempt: -1, user: res.user });
    setSessionToken(res.token);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // Revoking server-side is best effort; the local token is dropped regardless.
    }
    setSessionToken(null);
  }, []);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  let state: AuthState;
  if (token === undefined) state = { status: "loading" };
  else if (token === null) state = { status: "signed-out" };
  else if (verified?.token === token && verified.user) state = { status: "signed-in", user: verified.user };
  else if (verified?.token === token && verified.attempt === attempt && verified.error) {
    state = { status: "error", message: verified.error };
  } else state = { status: "loading" };

  return { ...state, signIn, signOut, retry };
}
