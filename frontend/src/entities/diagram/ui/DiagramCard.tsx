"use client";

import { useState, type ReactNode } from "react";
import { diagramTypeLabel, type Diagram } from "../model/schema";

/** `footer` lets higher layers attach actions (e.g. rating) without the entity importing features. */
export function DiagramCard({ diagram, footer }: { diagram: Diagram; footer?: ReactNode }) {
  const [showSource, setShowSource] = useState(false);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
      <header className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{diagram.title}</p>
          <p className="text-xs text-zinc-500">
            {diagramTypeLabel(diagram.type)} · {diagram.engine}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className="shrink-0 text-xs text-zinc-500 underline-offset-2 hover:underline"
        >
          {showSource ? "Diagram" : "Source"}
        </button>
      </header>

      {showSource || !diagram.svg ? (
        <div className="flex flex-col gap-2 p-4">
          {diagram.render_error && (
            <p className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              Render failed: {diagram.render_error}
            </p>
          )}
          <pre className="max-h-96 overflow-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
            {diagram.source}
          </pre>
        </div>
      ) : (
        <div className="overflow-auto bg-white p-4">
          {/* Rendered via <img> so any script inside the SVG cannot execute. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagram.svg)}`}
            alt={diagram.title}
            className="mx-auto h-auto max-w-full"
          />
        </div>
      )}
      {footer}
    </article>
  );
}
