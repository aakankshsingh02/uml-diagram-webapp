"use client";

import { useState } from "react";
import { ZodError, z } from "zod";
import { submitFeedback, type Rating } from "../api/submitFeedback";

interface RatingState {
  /** What the buttons show; set optimistically while a request is in flight. */
  selected: Rating | null;
  /** Last rating and comment the server accepted. */
  confirmed: { rating: Rating; comment: string } | null;
  pending: boolean;
  error: string | null;
}

const INITIAL: RatingState = { selected: null, confirmed: null, pending: false, error: null };

function toMessage(err: unknown): string {
  if (err instanceof ZodError) return z.prettifyError(err);
  return err instanceof Error ? err.message : "Could not save feedback";
}

export function useDiagramRating(diagramId: string) {
  const [state, setState] = useState<RatingState>(INITIAL);
  const [comment, setComment] = useState("");

  const trimmed = comment.trim();
  /** The comment box differs from what the server last accepted. */
  const dirty = state.confirmed !== null && state.confirmed.comment !== trimmed;

  async function send(rating: Rating) {
    setState((s) => ({ ...s, selected: rating, pending: true, error: null }));
    try {
      // Omitting `comment` clears it server-side (the upsert stores null).
      const res = await submitFeedback(diagramId, { rating, ...(trimmed ? { comment: trimmed } : {}) });
      setState({
        selected: res.rating,
        confirmed: { rating: res.rating, comment: res.comment ?? "" },
        pending: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, selected: s.confirmed?.rating ?? null, pending: false, error: toMessage(err) }));
    }
  }

  function rate(rating: Rating) {
    if (state.pending) return;
    if (state.confirmed?.rating === rating && !dirty) return;
    void send(rating);
  }

  function sendComment() {
    if (state.pending || !state.confirmed || !dirty) return;
    void send(state.confirmed.rating);
  }

  return {
    selected: state.selected,
    canSendComment: !state.pending && dirty,
    pending: state.pending,
    /** True only while the saved state matches what is on screen. */
    saved: state.confirmed !== null && !state.pending && !dirty,
    error: state.error,
    comment,
    setComment,
    rate,
    sendComment,
  };
}
