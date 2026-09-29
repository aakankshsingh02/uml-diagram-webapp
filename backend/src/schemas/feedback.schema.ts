import { z } from "zod";

export const DiagramParamsSchema = z.strictObject({
  id: z.uuid(),
});

export const FeedbackRequestSchema = z.strictObject({
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((c) => c || null),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
