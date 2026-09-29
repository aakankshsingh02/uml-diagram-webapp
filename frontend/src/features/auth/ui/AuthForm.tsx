"use client";

import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "@/shared/lib";
import { Button } from "@/shared/ui";
import type { Credentials } from "../api/auth";
import type { AuthMode } from "../model/useAuth";

interface Props {
  onSubmit: (mode: AuthMode, credentials: Credentials) => Promise<void>;
}

const COPY = {
  login: { title: "Sign in", submit: "Sign in", pending: "Signing in…", switchPrompt: "No account yet?", switchTo: "Create one" },
  signup: { title: "Create an account", submit: "Create account", pending: "Creating account…", switchPrompt: "Already have an account?", switchTo: "Sign in" },
} as const;

export function AuthForm({ onSubmit }: Props) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const emailId = useId();
  const passwordId = useId();
  const hintId = useId();
  const copy = COPY[mode];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onSubmit(mode, { email, password });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === "login" ? "signup" : "login"));
    setError(undefined);
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900"
    >
      <div>
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <p className="text-sm text-zinc-500">Your chats are saved to your account.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={emailId} className="text-sm font-medium">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10 rounded-lg border border-black/10 bg-transparent px-3 text-base outline-none focus:border-foreground sm:text-sm dark:border-white/15"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={passwordId} className="text-sm font-medium">
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={mode === "signup" ? 8 : undefined}
          maxLength={128}
          aria-describedby={mode === "signup" ? hintId : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10 rounded-lg border border-black/10 bg-transparent px-3 text-base outline-none focus:border-foreground sm:text-sm dark:border-white/15"
        />
        {mode === "signup" && (
          <p id={hintId} className="text-xs text-zinc-500">
            At least 8 characters.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? copy.pending : copy.submit}
      </Button>

      <p className="text-center text-sm text-zinc-500">
        {copy.switchPrompt}{" "}
        <button
          type="button"
          onClick={switchMode}
          disabled={pending}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {copy.switchTo}
        </button>
      </p>
    </form>
  );
}
