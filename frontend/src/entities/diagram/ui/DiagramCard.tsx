"use client";

import { useEffect, useState, type ReactNode } from "react";
import { downloadBlob, downloadSvg, fileName, svgDataUrl, svgToPng } from "../lib/export";
import { diagramTypeLabel, type Diagram } from "../model/schema";
import { DiagramViewer } from "./DiagramViewer";

const action =
  "shrink-0 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** `footer` lets higher layers attach actions (e.g. rating) without the entity importing features. */
export function DiagramCard({ diagram, footer }: { diagram: Diagram; footer?: ReactNode }) {
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { svg } = diagram;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(diagram.source);
      setNotice("Source copied");
    } catch {
      setNotice("Copy failed: clipboard unavailable");
    }
  };

  const savePng = async () => {
    if (!svg) return;
    try {
      downloadBlob(await svgToPng(svg), fileName(diagram.title, "png"));
    } catch {
      setNotice("PNG isn't available for this diagram; use SVG");
    }
  };

  const exportActions = (
    <>
      {notice && (
        <span role="status" className="text-xs text-zinc-500">
          {notice}
        </span>
      )}
      <button type="button" className={action} onClick={copySource}>
        Copy source
      </button>
      <button type="button" className={action} disabled={!svg} onClick={() => svg && downloadSvg(svg, diagram.title)}>
        SVG
      </button>
      <button type="button" className={action} disabled={!svg} onClick={savePng}>
        PNG
      </button>
    </>
  );

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
      <header className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{diagram.title}</p>
          <p className="text-xs text-zinc-500">
            {diagramTypeLabel(diagram.type)} · {diagram.engine}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <button type="button" className={action} disabled={!svg} onClick={() => setExpanded(true)}>
            Expand
          </button>
          {exportActions}
          <button type="button" className={action} onClick={() => setShowSource((s) => !s)}>
            {showSource ? "Diagram" : "Source"}
          </button>
        </div>
      </header>

      {showSource || !svg ? (
        <div className="flex flex-col gap-2 p-4">
          {diagram.render_error && (
            <p className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              Render failed: {diagram.render_error}
            </p>
          )}
          <pre className="max-h-96 overflow-auto rounded-md bg-zinc-100 p-3 text-xs select-text dark:bg-zinc-800">
            {diagram.source}
          </pre>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Open to zoom and pan"
          className="block cursor-zoom-in overflow-auto bg-white p-4"
        >
          {/* Rendered via <img> so any script inside the SVG cannot execute. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={svgDataUrl(svg)} alt={diagram.title} className="mx-auto h-auto max-h-[28rem] max-w-full" />
        </button>
      )}
      {footer}

      {expanded && svg && (
        <DiagramViewer svg={svg} title={diagram.title} actions={exportActions} onClose={() => setExpanded(false)} />
      )}
    </article>
  );
}
