import { z } from "zod";
import { apiRequest } from "@/shared/api";
import { ConversationSummarySchema } from "../model/schema";

const ListResponseSchema = z.strictObject({ conversations: z.array(ConversationSummarySchema) });

/** The signed-in user's conversations, most recently updated first. */
export async function listConversations() {
  return (await apiRequest("/conversations", ListResponseSchema)).conversations;
}
