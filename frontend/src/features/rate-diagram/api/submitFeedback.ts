import { z } from "zod";
import { apiRequest } from "@/shared/api";

export const RatingSchema = z.union([z.literal(1), z.literal(-1)]);
export type Rating = z.infer<typeof RatingSchema>;

export const FeedbackRequestSchema = z.strictObject({
  rating: RatingSchema,
  comment: z.string().trim().max(2000).optional(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const FeedbackResponseSchema = z.strictObject({
  id: z.uuid(),
  diagram_id: z.uuid(),
  rating: RatingSchema,
  comment: z.string().nullable(),
});
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;

export function submitFeedback(diagramId: string, input: FeedbackRequest) {
  return apiRequest(`/diagrams/${encodeURIComponent(diagramId)}/feedback`, FeedbackResponseSchema, {
    method: "POST",
    json: FeedbackRequestSchema.parse(input),
  });
}
