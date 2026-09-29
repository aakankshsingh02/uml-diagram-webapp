import type { Queryable } from "../db/pool.js";

export interface Feedback {
  id: string;
  diagram_id: string;
  user_id: string;
  rating: 1 | -1;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

export class FeedbackRepository {
  constructor(private readonly db: Queryable) {}

  /** One feedback row per user per diagram; a new rating replaces the previous one. */
  async upsert(
    diagramId: string,
    userId: string,
    rating: 1 | -1,
    comment: string | null,
    db: Queryable = this.db,
  ): Promise<Feedback> {
    const { rows } = await db.query<Feedback>(
      `INSERT INTO feedback (diagram_id, user_id, rating, comment, updated_at)
       VALUES ($1, $2, $3, $4, clock_timestamp())
       ON CONFLICT (diagram_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = clock_timestamp()
       RETURNING *`,
      [diagramId, userId, rating, comment],
    );
    return rows[0]!;
  }
}
