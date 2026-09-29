import { z } from "zod";

/**
 * Which LLM exchange a generation row records: the architecture model, or the diagrams the LLM drew
 * (projected diagrams have no exchange of their own; they come from the architecture model).
 */
export const GenerationKindSchema = z.enum(["architecture", "diagrams"]);
export type GenerationKind = z.infer<typeof GenerationKindSchema>;

export const TrajectoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  kind: GenerationKindSchema.default("diagrams"),
});

export const AckRequestSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(1000),
  // Kept as the exact string from X-Export-As-Of so microsecond precision survives to SQL.
  as_of: z.iso.datetime({ offset: true }),
});
export type AckRequest = z.infer<typeof AckRequestSchema>;
