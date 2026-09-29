"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { svgDataUrl, svgSize } from "../lib/export";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STEP = 1.25;

interface View {
  scale: number;
  x: number;
  y: number;
}

const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/** Full-screen pan/zoom viewer: wheel or buttons to zoom, drag to pan, Esc to close. */
export function DiagramViewer({
  svg,
  title,
  actions,
  onClose,
}: {
  svg: string;
  title: string;
  actions?: ReactNode;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const size = svgSize(svg);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });

  const fit = useCallback(() => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const scale = clamp(Math.min((box.width - 48) / size.width, (box.height - 48) / size.height));
    setView({ scale, x: (box.width - size.width * scale) / 2, y: (box.height - size.height * scale) / 2 });
  }, [size.width, size.height]);

  /** Zooms by `factor`, keeping the stage point (px, py) fixed; defaults to the stage centre. */
  const zoom = useCallback((factor: number, px?: number, py?: number) => {
    const box = stage.current?.getBoundingClientRect();
    const cx = px ?? (box ? box.width / 2 : 0);
    const cy = py ?? (box ? box.height / 2 : 0);
    setView((v) => {
      const scale = clamp(v.scale * factor);
      const ratio = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  // Fit once the stage has been laid out.
  useEffect(() => {
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [fit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoom(STEP);
      else if (e.key === "-") zoom(1 / STEP);
      else if (e.key === "0") fit();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, zoom, fit]);

  // React's onWheel is passive, so preventDefault (to stop page scroll) needs a native listener.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - box.left, e.clientY - box.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const button =
    "rounded-md border border-black/10 bg-white px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-white/10 dark:bg-zinc-800 dark:hover:bg-zinc-700";

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-zinc-950/80">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white px-4 py-2 dark:bg-zinc-900">
        <p className="mr-auto truncate text-sm font-semibold">{title}</p>
        <button type="button" className={button} onClick={() => zoom(1 / STEP)} aria-label="Zoom out">
          −
        </button>
        <span className="w-12 text-center text-xs tabular-nums text-zinc-500">{Math.round(view.scale * 100)}%</span>
        <button type="button" className={button} onClick={() => zoom(STEP)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className={button} onClick={fit}>
          Fit
        </button>
        <button type="button" className={button} onClick={() => zoom(1 / view.scale)}>
          100%
        </button>
        {actions}
        <button type="button" className={button} onClick={onClose} aria-label="Close viewer">
          Close
        </button>
      </div>
      <div
        ref={stage}
        className="relative flex-1 cursor-grab touch-none overflow-hidden bg-white active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          zoom(2, e.clientX - box.left, e.clientY - box.top);
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {/* Rendered via <img> so any script inside the SVG cannot execute. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={svgDataUrl(svg)}
            alt={title}
            width={size.width}
            height={size.height}
            draggable={false}
            className="block max-w-none select-none"
          />
        </div>
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-zinc-900/70 px-2 py-1 text-[11px] text-white">
          Scroll to zoom · drag to pan · double-click to zoom in · 0 to fit · Esc to close
        </p>
      </div>
    </div>
  );
}
