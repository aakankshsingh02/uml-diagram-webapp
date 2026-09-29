import { z } from "zod";
import { DiagramSchema, DiagramTypeSchema } from "@/entities/diagram";
import { apiRequest } from "@/shared/api";

export const ConversationSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  versions: z.array(
    z.strictObject({
      version: z.number().int().positive(),
      prompt: z.string(),
      diagram_types: z.array(DiagramTypeSchema),
      created_at: z.iso.datetime(),
      diagrams: z.array(DiagramSchema),
    }),
  ),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export function getConversation(id: string) {
  return apiRequest(`/conversations/${encodeURIComponent(id)}`, ConversationSchema);
}
