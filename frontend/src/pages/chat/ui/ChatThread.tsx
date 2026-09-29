import { DiagramCard, diagramTypeLabel } from "@/entities/diagram";
import type { ChatTurn } from "@/features/generate-diagrams";
import { RateDiagram } from "@/features/rate-diagram";

export function ChatThread({ turns }: { turns: ChatTurn[] }) {
  if (turns.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-zinc-500">
        <p className="text-lg font-medium text-foreground">Describe a system, get UML.</p>
        <p className="max-w-md text-sm">
          Pick the diagram types you need. Follow-up messages update the same design as a new version.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-8">
      {turns.map((turn) => (
        <li key={turn.id} className="flex flex-col gap-3">
          <div className="ml-auto max-w-2xl rounded-2xl bg-foreground px-4 py-3 text-sm text-background">
            <p className="whitespace-pre-wrap">{turn.prompt}</p>
            <p className="mt-2 text-xs opacity-70">{turn.diagramTypes.map(diagramTypeLabel).join(" · ")}</p>
          </div>

          {turn.error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {turn.error}
            </p>
          ) : turn.diagrams ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-500">Version {turn.version}</p>
              <div className="grid gap-4 lg:grid-cols-2">
                {turn.diagrams.map((d) => (
                  <DiagramCard key={d.id} diagram={d} footer={<RateDiagram diagramId={d.id} />} />
                ))}
              </div>
            </div>
          ) : (
            <p className="animate-pulse text-sm text-zinc-500">Generating diagrams…</p>
          )}
        </li>
      ))}
    </ol>
  );
}
