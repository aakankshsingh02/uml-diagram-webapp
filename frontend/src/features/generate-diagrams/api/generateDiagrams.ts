import { z } from "zod";
import { DiagramSchema, DiagramTypeSchema } from "@/entities/diagram";
import { apiStream, type StreamProgress, type StreamThinking } from "@/shared/api";

export const GenerateDiagramsRequestSchema = z.strictObject({
  conversation_id: z.uuid().optional(),
  prompt: z.string().trim().min(10, "Describe your system in at least 10 characters"),
  diagram_types: z.array(DiagramTypeSchema).min(1, "Pick at least one diagram type"),
});
export type GenerateDiagramsRequest = z.infer<typeof GenerateDiagramsRequestSchema>;

export const GenerateDiagramsResponseSchema = z.strictObject({
  conversation_id: z.uuid(),
  version: z.number().int().positive(),
  diagrams: z.array(DiagramSchema),
});
export type GenerateDiagramsResponse = z.infer<typeof GenerateDiagramsResponseSchema>;

/** Streams the backend's steps and the model's words while the diagrams are generated. */
export function generateDiagrams(
  input: GenerateDiagramsRequest,
  handlers: { onProgress?: (event: StreamProgress) => void; onThinking?: (event: StreamThinking) => void } = {},
) {
  return apiStream("/diagrams/generate", GenerateDiagramsResponseSchema, {
    method: "POST",
    json: GenerateDiagramsRequestSchema.parse(input),
    onProgress: handlers.onProgress ?? (() => {}),
    onThinking: handlers.onThinking,
  });
}
