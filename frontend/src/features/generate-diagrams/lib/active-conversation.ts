// Per user, so a shared browser never reopens someone else's last chat.
const key = (userId: string) => `uml.activeConversation.${userId}`;

export function recallActiveConversation(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function rememberActiveConversation(userId: string, conversationId: string | null): void {
  try {
    if (conversationId) localStorage.setItem(key(userId), conversationId);
    else localStorage.removeItem(key(userId));
  } catch {
    // Storage unavailable: the chat just won't reopen after a reload.
  }
}
