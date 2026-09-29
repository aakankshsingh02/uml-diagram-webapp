"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZodError, z } from "zod";
import type { Diagram, DiagramType } from "@/entities/diagram";
import { ApiError, type StreamProgress, type StreamThinking } from "@/shared/api";
import { errorMessage } from "@/shared/lib";
import { generateDiagrams } from "../api/generateDiagrams";
import { getConversation, type Conversation } from "../api/getConversation";
import { recallActiveConversation, rememberActiveConversation } from "../lib/active-conversation";

export interface ChatTurn {
  id: string;
  prompt: string;
  diagramTypes: DiagramType[];
  version?: number;
  diagrams?: Diagram[];
  error?: string;
  /** While generating: when the request started and the steps the backend has reported so far. */
  startedAt?: number;
  progress?: StreamProgress[];
  /** The model's words while generating, one segment per model call (attempts get their own). */
  thinking?: ThinkingSegment[];
}

export interface ThinkingSegment {
  call: string;
  reasoning: string;
  answer: string;
}

/** Keeps the tail of very long text: the latest words are the interesting ones while it streams. */
const MAX_SEGMENT_CHARS = 20_000;
const tail = (text: string) => (text.length > MAX_SEGMENT_CHARS ? text.slice(-MAX_SEGMENT_CHARS) : text);

function appendThinking(segments: ThinkingSegment[] = [], event: StreamThinking): ThinkingSegment[] {
  const last = segments.at(-1);
  const current = last?.call === event.call ? last : { call: event.call, reasoning: "", answer: "" };
  const next = { ...current, [event.channel]: tail(current[event.channel] + event.text) };
  return current === last ? [...segments.slice(0, -1), next] : [...segments, next];
}

interface Options {
  /** Called after a prompt is saved, e.g. to refresh a conversation list. */
  onSaved?: (conversationId: string) => void;
}

/**
 * Holds one conversation: first send creates it, later sends update it (new version).
 * The open conversation is remembered per user and reopened after a reload.
 */
export function useChatSession(userId: string, { onSaved }: Options = {}) {
  const [conversationId, setConversationId] = useState<string>();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState(false);
  // Starts true when there is a chat to reopen, so the empty state does not flash on reload.
  const [loading, setLoading] = useState(() => recallActiveConversation(userId) !== null);
  const [loadError, setLoadError] = useState<string>();
  // Bumped by every open/reset; responses to an older request are dropped.
  const request = useRef(0);

  const show = useCallback(
    (conversation: Conversation) => {
      setConversationId(conversation.id);
      setTurns(conversation.versions.map((v) => toTurn(conversation.id, v)));
      rememberActiveConversation(userId, conversation.id);
    },
    [userId],
  );

  useEffect(() => {
    const id = recallActiveConversation(userId);
    if (!id) return;
    const current = ++request.current;
    getConversation(id).then(
      (conversation) => {
        if (current !== request.current) return;
        show(conversation);
        setLoading(false);
      },
      (err) => {
        if (current !== request.current) return;
        // Gone or not this user's: start fresh. Anything else is worth showing.
        if (err instanceof ApiError && err.status === 404) rememberActiveConversation(userId, null);
        else setLoadError(errorMessage(err));
        setLoading(false);
      },
    );
  }, [userId, show]);

  const open = useCallback(
    async (id: string) => {
      const current = ++request.current;
      setConversationId(undefined);
      setTurns([]);
      setLoadError(undefined);
      setLoading(true);
      try {
        const conversation = await getConversation(id);
        if (current === request.current) show(conversation);
      } catch (err) {
        if (current === request.current) setLoadError(errorMessage(err));
      } finally {
        if (current === request.current) setLoading(false);
      }
    },
    [show],
  );

  const send = useCallback(
    async (prompt: string, diagramTypes: DiagramType[]) => {
      const turnId = crypto.randomUUID();
      setTurns((t) => [...t, { id: turnId, prompt, diagramTypes, startedAt: Date.now(), progress: [] }]);
      setPending(true);

      const update = (change: (turn: ChatTurn) => Partial<ChatTurn>) =>
        setTurns((t) => t.map((turn) => (turn.id === turnId ? { ...turn, ...change(turn) } : turn)));
      const patch = (fields: Partial<ChatTurn>) => update(() => fields);

      try {
        const res = await generateDiagrams(
          { conversation_id: conversationId, prompt, diagram_types: diagramTypes },
          {
            onProgress: (event) => update((turn) => ({ progress: [...(turn.progress ?? []), event] })),
            onThinking: (event) => update((turn) => ({ thinking: appendThinking(turn.thinking, event) })),
          },
        );
        setConversationId(res.conversation_id);
        rememberActiveConversation(userId, res.conversation_id);
        patch({ version: res.version, diagrams: res.diagrams });
        onSaved?.(res.conversation_id);
      } catch (err) {
        patch({ error: toMessage(err) });
      } finally {
        setPending(false);
      }
    },
    [conversationId, userId, onSaved],
  );

  const reset = useCallback(() => {
    request.current++;
    setConversationId(undefined);
    setTurns([]);
    setLoading(false);
    setLoadError(undefined);
    rememberActiveConversation(userId, null);
  }, [userId]);

  return { conversationId, turns, pending, loading, loadError, send, open, reset };
}

function toTurn(conversationId: string, v: Conversation["versions"][number]): ChatTurn {
  return {
    id: `${conversationId}:${v.version}`,
    prompt: v.prompt,
    diagramTypes: v.diagram_types,
    version: v.version,
    diagrams: v.diagrams,
  };
}

function toMessage(err: unknown): string {
  if (err instanceof ZodError) return z.prettifyError(err);
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return "Something went wrong";
}
