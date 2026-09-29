import type { Queryable } from "../db/pool.js";

export interface User {
  id: string;
  email: string;
  created_at: Date;
}

export interface UserWithPassword extends User {
  password_hash: string;
}

export class UserRepository {
  constructor(private readonly db: Queryable) {}

  /** Returns null when the email is already registered. */
  async create(email: string, passwordHash: string, db: Queryable = this.db): Promise<User | null> {
    const { rows } = await db.query<User>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, created_at`,
      [email, passwordHash],
    );
    return rows[0] ?? null;
  }

  async updatePasswordHash(id: string, passwordHash: string, db: Queryable = this.db): Promise<void> {
    await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, passwordHash]);
  }

  async findByEmail(email: string, db: Queryable = this.db): Promise<UserWithPassword | null> {
    const { rows } = await db.query<UserWithPassword>(
      "SELECT id, email, password_hash, created_at FROM users WHERE email = $1",
      [email],
    );
    return rows[0] ?? null;
  }
}
