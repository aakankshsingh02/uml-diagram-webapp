import type { Queryable } from "../db/pool.js";

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  version: number;
  prompt: string;
  diagram_types: string[];
  created_at: Date;
}

export class ConversationRepository {
  constructor(private readonly db: Queryable) {}

  async create(userId: string, title: string, db: Queryable = this.db): Promise<Conversation> {
    const { rows } = await db.query<Conversation>(
      "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *",
      [userId, title],
    );
    return rows[0]!;
  }

  async findById(id: string, db: Queryable = this.db): Promise<Conversation | null> {
    const { rows } = await db.query<Conversation>("SELECT * FROM conversations WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  /** A user's conversations, most recently updated first. */
  async listByUser(userId: string, db: Queryable = this.db): Promise<Conversation[]> {
    const { rows } = await db.query<Conversation>(
      "SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC, id",
      [userId],
    );
    return rows;
  }

  async touch(id: string, db: Queryable = this.db): Promise<void> {
    await db.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [id]);
  }

  /** Appends a prompt as the next version of the conversation. */
  async addMessage(
    conversationId: string,
    prompt: string,
    diagramTypes: string[],
    db: Queryable = this.db,
  ): Promise<Message> {
    const { rows } = await db.query<Message>(
      `INSERT INTO messages (conversation_id, version, prompt, diagram_types)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(version), 0) + 1 FROM messages WHERE conversation_id = $1),
         $2,
         $3
       )
       RETURNING *`,
      [conversationId, prompt, diagramTypes],
    );
    return rows[0]!;
  }

  async findLatestMessage(conversationId: string, db: Queryable = this.db): Promise<Message | null> {
    const { rows } = await db.query<Message>(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY version DESC LIMIT 1",
      [conversationId],
    );
    return rows[0] ?? null;
  }

  async listMessages(conversationId: string, db: Queryable = this.db): Promise<Message[]> {
    const { rows } = await db.query<Message>(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY version ASC",
      [conversationId],
    );
    return rows;
  }
}
