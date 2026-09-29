import { z } from "zod";

export const ConversationSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
