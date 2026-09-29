import type { ConversationSummary } from "@/entities/conversation";
import type { User } from "@/entities/user";
import { Button } from "@/shared/ui";

interface Props {
  user: User;
  conversations?: ConversationSummary[];
  error?: string;
  activeId?: string;
  /** While a prompt is generating, switching chats is blocked. */
  disabled: boolean;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onRetry: () => void;
  onSignOut: () => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function ConversationSidebar({
  user,
  conversations,
  error,
  activeId,
  disabled,
  onOpen,
  onNewChat,
  onRetry,
  onSignOut,
}: Props) {
  return (
    <nav aria-label="Chats" className="flex h-full w-full flex-col gap-3 p-3">
      <Button variant="ghost" onClick={onNewChat} disabled={disabled} className="w-full">
        New chat
      </Button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="flex flex-col items-start gap-2 p-2 text-sm">
            <p className="text-red-700 dark:text-red-300">Couldn&apos;t load chats: {error}</p>
            <button type="button" onClick={onRetry} className="underline underline-offset-2">
              Try again
            </button>
          </div>
        ) : !conversations ? (
          <p className="animate-pulse p-2 text-sm text-zinc-500">Loading chats…</p>
        ) : conversations.length === 0 ? (
          <p className="p-2 text-sm text-zinc-500">No saved chats yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    disabled={disabled}
                    aria-current={active ? "page" : undefined}
                    className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      active ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    <span className="w-full truncate text-sm">{c.title}</span>
                    <span className="text-xs text-zinc-500">{dateFormat.format(new Date(c.updated_at))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-3 dark:border-white/10">
        <span className="min-w-0 truncate text-xs text-zinc-500" title={user.email}>
          {user.email}
        </span>
        <button
          type="button"
          onClick={onSignOut}
          className="shrink-0 text-xs font-medium underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
