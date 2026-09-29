"use client";

import { useCallback, useEffect, useState } from "react";
import { listConversations, type ConversationSummary } from "@/entities/conversation";
import { errorMessage } from "@/shared/lib";

/** The signed-in user's saved conversations; `refresh` after a prompt is saved. */
export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(
    (isCurrent: () => boolean = () => true) =>
      listConversations().then(
        (list) => {
          if (!isCurrent()) return;
          setConversations(list);
          setError(undefined);
        },
        (err) => {
          if (isCurrent()) setError(errorMessage(err));
        },
      ),
    [],
  );

  useEffect(() => {
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);

  return { conversations, error, refresh };
}
