"use client";

import { useState, type FormEvent } from "react";
import { DIAGRAM_TYPES, type DiagramType } from "@/entities/diagram";
import { Button } from "@/shared/ui";

interface Props {
  pending: boolean;
  isFollowUp: boolean;
  onSubmit: (prompt: string, diagramTypes: DiagramType[]) => void;
}

export function PromptComposer({ pending, isFollowUp, onSubmit }: Props) {
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<DiagramType[]>(["sequence", "component"]);

  const toggle = (type: DiagramType) =>
    setSelected((s) => (s.includes(type) ? s.filter((t) => t !== type) : [...s, type]));

  const canSubmit = !pending && prompt.trim().length >= 10 && selected.length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(prompt.trim(), selected);
    setPrompt("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-zinc-900"
    >
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(e);
        }}
        rows={4}
        placeholder={
          isFollowUp
            ? "Describe what changed — the diagrams will be updated…"
            : "Describe the software you want to design…"
        }
        className="w-full resize-y bg-transparent text-sm outline-none placeholder:text-zinc-400"
      />
      <div className="flex flex-wrap gap-1.5">
        {DIAGRAM_TYPES.map((t) => {
          const active = selected.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              aria-pressed={active}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-black/10 text-zinc-600 hover:bg-black/5 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">Ctrl/⌘ + Enter to send</span>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? "Generating…" : isFollowUp ? "Update diagrams" : "Generate"}
        </Button>
      </div>
    </form>
  );
}
