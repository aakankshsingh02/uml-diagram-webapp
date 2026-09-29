import { HttpError } from "../lib/http-error.js";
import type { ConversationRepository } from "../repositories/conversation.repository.js";
import type { DiagramRepository } from "../repositories/diagram.repository.js";
import { toDto } from "./diagram.service.js";

export class ConversationService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly diagrams: DiagramRepository,
  ) {}

  async list(userId: string) {
    const conversations = await this.conversations.listByUser(userId);
    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
    };
  }

  /** Another user's conversation gets the same 404 as a missing one. */
  async getById(userId: string, id: string) {
    const conversation = await this.conversations.findById(id);
    if (!conversation || conversation.user_id !== userId) throw HttpError.notFound("Conversation not found");

    const messages = await this.conversations.listMessages(id);
    const versions = await Promise.all(
      messages.map(async (m) => ({
        version: m.version,
        prompt: m.prompt,
        diagram_types: m.diagram_types,
        created_at: m.created_at,
        diagrams: (await this.diagrams.findByMessageId(m.id)).map(toDto),
      })),
    );

    return { id: conversation.id, title: conversation.title, versions };
  }
}
