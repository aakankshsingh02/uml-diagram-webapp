import { z } from "zod";

/** The 14 UML 2.x diagram types. */
export const DIAGRAM_TYPES = [
  // Structure
  "class",
  "object",
  "component",
  "composite_structure",
  "deployment",
  "package",
  "profile",
  // Behavior
  "use_case",
  "activity",
  "state_machine",
  // Interaction
  "sequence",
  "communication",
  "interaction_overview",
  "timing",
] as const;

export const DiagramTypeSchema = z.enum(DIAGRAM_TYPES);
export type DiagramType = z.infer<typeof DiagramTypeSchema>;

export const EngineSchema = z.enum(["mermaid", "plantuml", "excalidraw"]);
export type Engine = z.infer<typeof EngineSchema>;

/**
 * Mermaid where it has a native UML syntax; PlantUML (bundled in Kroki core) covers the rest.
 * Excalidraw is available in Kroki for hand-drawn exports but is not an LLM target.
 */
export const ENGINE_BY_TYPE: Record<DiagramType, Engine> = {
  class: "mermaid",
  sequence: "mermaid",
  state_machine: "mermaid",
  activity: "mermaid",
  object: "plantuml",
  component: "plantuml",
  composite_structure: "plantuml",
  deployment: "plantuml",
  package: "plantuml",
  profile: "plantuml",
  use_case: "plantuml",
  communication: "plantuml",
  interaction_overview: "plantuml",
  timing: "plantuml",
};

const TYPE_ALIASES: Record<string, DiagramType> = {
  sequential: "sequence",
  state: "state_machine",
  statemachine: "state_machine",
  usecase: "use_case",
  composite: "composite_structure",
  overview: "interaction_overview",
};

/** Accepts loose client input ("Sequential", "use-case") and normalizes it to a canonical type. */
const DiagramTypeInputSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return TYPE_ALIASES[key.replace(/_/g, "")] ?? key;
}, DiagramTypeSchema);

export const GenerateDiagramsRequestSchema = z.strictObject({
  conversation_id: z.uuid().optional(),
  prompt: z.string().trim().min(10).max(20_000),
  diagram_types: z
    .array(DiagramTypeInputSchema)
    .min(1)
    .max(DIAGRAM_TYPES.length)
    .transform((types) => [...new Set(types)]),
});
export type GenerateDiagramsRequest = z.infer<typeof GenerateDiagramsRequestSchema>;

/** Shape the LLM must return. Strict: unknown keys are rejected, not stripped. */
/**
 * Models sometimes double-escape `source` inside their JSON, so after parsing it holds literal
 * "\n" / "\"" sequences on a single line. PlantUML then sees no diagram body and silently renders
 * its welcome page. A source with no real line break but literal "\n" is unescaped once.
 */
export function unescapeDoubleEscapedSource(source: string): string {
  if (/[\r\n]/.test(source) || !source.includes("\\n")) return source;
  return source.replace(/\\(r\\n|n|t|"|\\)/g, (_, seq: string) =>
    seq === "n" || seq === "r\\n" ? "\n" : seq === "t" ? "\t" : seq,
  );
}

const DiagramSourceSchema = z.string().min(1).transform(unescapeDoubleEscapedSource);

export const LlmDiagramSchema = z.strictObject({
  type: DiagramTypeSchema,
  title: z.string().min(1).max(200),
  source: DiagramSourceSchema,
});
export type LlmDiagram = z.infer<typeof LlmDiagramSchema>;

export const LlmDiagramsResponseSchema = z.strictObject({
  diagrams: z.array(LlmDiagramSchema).min(1),
});
export type LlmDiagramsResponse = z.infer<typeof LlmDiagramsResponseSchema>;

export const LlmRepairResponseSchema = z.strictObject({
  source: DiagramSourceSchema,
});

export const ConversationParamsSchema = z.strictObject({
  id: z.uuid(),
});
