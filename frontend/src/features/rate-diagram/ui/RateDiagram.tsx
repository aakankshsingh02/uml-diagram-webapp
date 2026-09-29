"use client";

import { useId, type FormEvent } from "react";
import type { Rating } from "../api/submitFeedback";
import { useDiagramRating } from "../model/useDiagramRating";

const OPTIONS: { rating: Rating; icon: string; label: string }[] = [
  { rating: 1, icon: "👍", label: "Rate helpful" },
  { rating: -1, icon: "👎", label: "Rate not helpful" },
];

export function RateDiagram({ diagramId }: { diagramId: string }) {
  const { selected, canSendComment, pending, saved, error, comment, setComment, rate, sendComment } =
    useDiagramRating(diagramId);
  const promptId = useId();
  const commentId = useId();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendComment();
  };

  return (
    <div className="flex flex-col gap-2 border-t border-black/10 px-4 py-3 dark:border-white/10">
      <div role="group" aria-labelledby={promptId} className="flex items-center gap-2">
        <span id={promptId} className="text-xs text-zinc-500">
          Is this diagram right?
        </span>
        {OPTIONS.map((o) => (
          <button
            key={o.rating}
            type="button"
            aria-label={o.label}
            aria-pressed={selected === o.rating}
            disabled={pending}
            onClick={() => rate(o.rating)}
            className={`rounded-md border px-2 py-0.5 text-sm transition disabled:opacity-50 ${
              selected === o.rating
                ? "border-foreground bg-foreground/10"
                : "border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            }`}
          >
            {o.icon}
          </button>
        ))}
        {/* Live regions stay mounted so screen readers announce text changes. */}
        <span role="status" className="text-xs text-zinc-500">
          {saved ? "Thanks — feedback saved" : ""}
        </span>
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <label htmlFor={commentId} className="sr-only">
          Comment (optional)
        </label>
        <input
          id={commentId}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
          placeholder="What's wrong or missing? (optional)"
          className="min-w-0 flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground dark:border-white/15"
        />
        <button
          type="submit"
          disabled={!canSendComment}
          className="shrink-0 rounded-md border border-black/10 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10"
        >
          Send comment
        </button>
      </form>

      <p role="alert" className="text-xs text-red-600 empty:hidden dark:text-red-400">
        {error ?? ""}
      </p>
    </div>
  );
}
