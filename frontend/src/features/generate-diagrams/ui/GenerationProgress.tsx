"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamProgress } from "@/shared/api";
import type { ThinkingSegment } from "../model/useChatSession";

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

/** Live view of a generation: the current step, a running timer, the steps so far and the model's words. */
export function GenerationProgress({
  startedAt,
  steps,
  thinking = [],
}: {
  startedAt?: number;
  steps: StreamProgress[];
  thinking?: ThinkingSegment[];
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const current = steps.at(-1);
  const elapsed = startedAt ? Math.max(0, now - startedAt) : (current?.elapsed_ms ?? 0);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 text-sm dark:border-white/10 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200"
        />
        <p className="flex-1 font-medium">{current?.message ?? "Starting…"}</p>
        <span className="tabular-nums text-xs text-zinc-500">{seconds(elapsed)}</span>
      </div>

      {thinking.length > 0 && (
        <div className="flex flex-col gap-2">
          {thinking.map((segment, i) => (
            <ThinkingPanel key={`${segment.call}-${i}`} segment={segment} live={i === thinking.length - 1} />
          ))}
        </div>
      )}

      {steps.length > 0 && (
        <details className="text-xs text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer select-none text-zinc-500">Steps ({steps.length})</summary>
          <ol className="mt-2 ml-1 flex flex-col gap-1.5 border-l border-black/10 pl-3 dark:border-white/10">
            {steps.map((step, i) => (
              <li key={i} className={i === steps.length - 1 ? "text-foreground" : undefined}>
                <span className="mr-2 tabular-nums text-zinc-400">{seconds(step.elapsed_ms)}</span>
                {step.message}
                {step.details && step.details.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-zinc-500">
                    {step.details.slice(0, 8).map((detail, j) => (
                      <li key={j}>{detail}</li>
                    ))}
                    {step.details.length > 8 && <li>+{step.details.length - 8} more</li>}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** One model call's words: reasoning as it streams, then the answer being written. */
function ThinkingPanel({ segment, live }: { segment: ThinkingSegment; live: boolean }) {
  const box = useRef<HTMLPreElement>(null);
  const pinned = useRef(true); // follow new text unless the reader scrolled up

  useEffect(() => {
    const el = box.current;
    if (el && live && pinned.current) el.scrollTop = el.scrollHeight;
  }, [segment.reasoning, segment.answer, live]);

  const writing = segment.answer.length > 0;

  return (
    <details open={live} className="rounded-lg bg-zinc-50 dark:bg-zinc-950">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {live && !writing ? "Thinking · " : ""}
        {segment.call}
        {writing && (
          <span className="ml-2 font-normal text-zinc-400">writing the answer · {segment.answer.length.toLocaleString()} chars</span>
        )}
      </summary>
      <pre
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400"
      >
        {segment.reasoning || (writing ? "" : "…")}
        {writing && (
          <span className="mt-2 block border-t border-black/10 pt-2 text-zinc-400 dark:border-white/10">
            {segment.answer.slice(-600)}
          </span>
        )}
      </pre>
    </details>
  );
}
