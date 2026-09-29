"use client";

import { useState } from "react";
import type { User } from "@/entities/user";
import { PromptComposer, useChatSession } from "@/features/generate-diagrams";
import { Button } from "@/shared/ui";
import { useConversations } from "../model/useConversations";
import { ChatThread } from "./ChatThread";
import { ConversationSidebar } from "./ConversationSidebar";

interface Props {
  user: User;
  onSignOut: () => void;
}

/** The signed-in app: saved chats on the left (a drawer on small screens), the open chat on the right. */
export function ChatWorkspace({ user, onSignOut }: Props) {
  const { conversations, error: listError, refresh } = useConversations();
  const { conversationId, turns, pending, loading, loadError, send, open, reset } = useChatSession(user.id, {
    onSaved: refresh,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openChat = (id: string) => {
    setDrawerOpen(false);
    if (id !== conversationId) void open(id);
  };
  const newChat = () => {
    setDrawerOpen(false);
    reset();
  };

  return (
    <div className="flex min-h-full flex-1 bg-zinc-50 dark:bg-black">
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close chats"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
        />
      )}
      <aside
        className={`${drawerOpen ? "fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw]" : "hidden"} border-r border-black/10 bg-zinc-50 md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 dark:border-white/10 dark:bg-black`}
      >
        <ConversationSidebar
          user={user}
          conversations={conversations}
          error={listError}
          activeId={conversationId}
          disabled={pending}
          onOpen={openChat}
          onNewChat={newChat}
          onRetry={() => void refresh()}
          onSignOut={onSignOut}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-black/10 bg-zinc-50/80 px-4 py-3 backdrop-blur md:px-6 dark:border-white/10 dark:bg-black/80">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setDrawerOpen(true)}
              aria-label="Show chats"
              aria-expanded={drawerOpen}
              className="px-3 md:hidden"
            >
              ☰
            </Button>
            <h1 className="truncate text-base font-semibold">UML Chat</h1>
          </div>
          <Button variant="ghost" onClick={newChat} disabled={pending || (turns.length === 0 && !loading)}>
            New chat
          </Button>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
          {loading ? (
            <p className="animate-pulse text-sm text-zinc-500">Loading chat…</p>
          ) : loadError ? (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              Couldn&apos;t open this chat: {loadError}
            </p>
          ) : (
            <ChatThread turns={turns} />
          )}
        </main>

        <footer className="sticky bottom-0 bg-gradient-to-t from-zinc-50 from-70% px-4 pb-4 pt-6 dark:from-black">
          <div className="mx-auto max-w-3xl">
            <PromptComposer pending={pending || loading} isFollowUp={Boolean(conversationId)} onSubmit={send} />
          </div>
        </footer>
      </div>
    </div>
  );
}
