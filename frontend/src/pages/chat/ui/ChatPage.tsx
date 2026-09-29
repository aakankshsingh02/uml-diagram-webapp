"use client";

import type { ReactNode } from "react";
import { AuthForm, useAuth } from "@/features/auth";
import { Button } from "@/shared/ui";
import { ChatWorkspace } from "./ChatWorkspace";

export function ChatPage() {
  const auth = useAuth();

  switch (auth.status) {
    case "loading":
      return (
        <Centered>
          <p className="animate-pulse text-sm text-zinc-500">Loading…</p>
        </Centered>
      );
    case "error":
      return (
        <Centered>
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            Couldn&apos;t reach the server: {auth.message}
          </p>
          <Button variant="ghost" onClick={auth.retry}>
            Try again
          </Button>
        </Centered>
      );
    case "signed-out":
      return (
        <Centered>
          <p className="text-base font-semibold">UML Chat</p>
          <AuthForm onSubmit={auth.signIn} />
        </Centered>
      );
    case "signed-in":
      // Keyed by user so nothing from a previous account survives a switch.
      return <ChatWorkspace key={auth.user.id} user={auth.user} onSignOut={() => void auth.signOut()} />;
  }
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-4 py-10 dark:bg-black">
      {children}
    </div>
  );
}
