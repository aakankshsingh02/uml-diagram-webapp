import { z } from "zod";

export const DIAGRAM_TYPES = [
  { id: "class", label: "Class", group: "Structure" },
  { id: "object", label: "Object", group: "Structure" },
  { id: "component", label: "Component", group: "Structure" },
  { id: "composite_structure", label: "Composite Structure", group: "Structure" },
  { id: "deployment", label: "Deployment", group: "Structure" },
  { id: "package", label: "Package", group: "Structure" },
  { id: "profile", label: "Profile", group: "Structure" },
  { id: "use_case", label: "Use Case", group: "Behavior" },
  { id: "activity", label: "Activity", group: "Behavior" },
  { id: "state_machine", label: "State Machine", group: "Behavior" },
  { id: "sequence", label: "Sequence", group: "Interaction" },
  { id: "communication", label: "Communication", group: "Interaction" },
  { id: "interaction_overview", label: "Interaction Overview", group: "Interaction" },
  { id: "timing", label: "Timing", group: "Interaction" },
] as const;

export type DiagramType = (typeof DIAGRAM_TYPES)[number]["id"];

export const DiagramTypeSchema = z.enum(
  DIAGRAM_TYPES.map((t) => t.id) as [DiagramType, ...DiagramType[]],
);

export const diagramTypeLabel = (type: DiagramType) =>
  DIAGRAM_TYPES.find((t) => t.id === type)?.label ?? type;

export const DiagramSchema = z.strictObject({
  id: z.uuid(),
  type: DiagramTypeSchema,
  engine: z.enum(["mermaid", "plantuml", "excalidraw"]),
  title: z.string(),
  source: z.string(),
  svg: z.string().nullable(),
  render_error: z.string().nullable(),
});

export type Diagram = z.infer<typeof DiagramSchema>;
