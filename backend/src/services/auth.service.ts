import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../lib/http-error.js";
import { hashPassword, needsRehash, verifyPassword } from "../lib/password.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type { User, UserRepository } from "../repositories/user.repository.js";
import type { LoginRequest, SignupRequest } from "../schemas/auth.schema.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest();

export class AuthService {
  // Verified against when the email is unknown, so login timing does not reveal registered emails.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly sessionTtlMs: number,
  ) {}

  async signup(input: SignupRequest) {
    const user = await this.users.create(input.email, await hashPassword(input.password));
    if (!user) throw new HttpError(409, "An account with this email already exists");
    return this.startSession(user);
  }

  async login(input: LoginRequest) {
    const user = await this.users.findByEmail(input.email);
    const stored = user?.password_hash ?? (await this.getDummyHash());
    const valid = await verifyPassword(input.password, stored);
    if (!user || !valid) throw new HttpError(401, "Invalid email or password");
    if (needsRehash(user.password_hash)) {
      await this.users.updatePasswordHash(user.id, await hashPassword(input.password));
    }
    return this.startSession(user);
  }

  private getDummyHash(): Promise<string> {
    // Not cached on failure (e.g. a 503 when hashing is saturated), or every later lookup would fail too.
    this.dummyHash ??= hashPassword("timing-equalizer").catch((err: unknown) => {
      this.dummyHash = undefined;
      throw err;
    });
    return this.dummyHash;
  }

  async logout(token: string): Promise<void> {
    await this.sessions.delete(hashToken(token));
  }

  /** The signed-in user for a bearer token, or null when unknown or expired. */
  authenticate(token: string): Promise<User | null> {
    return this.sessions.findUser(hashToken(token));
  }

  private async startSession(user: User) {
    const token = randomBytes(32).toString("base64url");
    await this.sessions.deleteExpired(user.id);
    await this.sessions.create(user.id, hashToken(token), new Date(Date.now() + this.sessionTtlMs));
    return { token, user: toUserDto(user) };
  }
}

export function toUserDto(user: User) {
  return { id: user.id, email: user.email, created_at: user.created_at };
}
