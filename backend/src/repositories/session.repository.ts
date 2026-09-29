import type { Queryable } from "../db/pool.js";
import type { User } from "./user.repository.js";

export class SessionRepository {
  constructor(private readonly db: Queryable) {}

  async create(userId: string, tokenHash: Buffer, expiresAt: Date, db: Queryable = this.db): Promise<void> {
    await db.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)", [
      userId,
      tokenHash,
      expiresAt,
    ]);
  }

  /** The owner of an unexpired session. */
  async findUser(tokenHash: Buffer, db: Queryable = this.db): Promise<User | null> {
    const { rows } = await db.query<User>(
      `SELECT u.id, u.email, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async delete(tokenHash: Buffer, db: Queryable = this.db): Promise<void> {
    await db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async deleteExpired(userId: string, db: Queryable = this.db): Promise<void> {
    await db.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()", [userId]);
  }
}
