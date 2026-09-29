import { createHash, randomBytes, scryptSync } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { generate, PASSWORD, resetDb, signup, testApp } from "../helpers.js";

const app = testApp();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(resetDb);
afterAll(() => pool.end());

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("POST /api/auth/signup", () => {
  it("creates a user with a UUID v4 id and a hashed password, and returns a working token", async () => {
    const res = await app.post("/api/auth/signup").send({ email: "  Asha@Example.COM ", password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: expect.stringMatching(UUID_V4), email: "asha@example.com", created_at: expect.any(String) },
    });

    const { rows } = await pool.query("SELECT email, password_hash FROM users");
    expect(rows).toHaveLength(1);
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain(PASSWORD);

    const me = await app.get("/api/auth/me").set(bearer(res.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual(res.body.user);
  });

  it("stores only the SHA-256 of the session token, expiring after SESSION_TTL_DAYS", async () => {
    const { token } = await signup(app, "asha");
    const { rows } = await pool.query(
      "SELECT token_hash, extract(epoch FROM expires_at - now())::float AS ttl_seconds FROM sessions",
    );
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0].token_hash)).toEqual(createHash("sha256").update(token).digest());
    expect(rows[0].ttl_seconds).toBeGreaterThan(30 * 86_400 - 60);
    expect(rows[0].ttl_seconds).toBeLessThanOrEqual(30 * 86_400);
  });

  it("returns 409 for an email that is already registered, ignoring case", async () => {
    await signup(app, "asha");
    const res = await app.post("/api/auth/signup").send({ email: "ASHA@example.com", password: PASSWORD });
    expect(res.status).toBe(409);
  });

  it.each([
    ["an invalid email", { email: "not-an-email", password: PASSWORD }],
    ["a short password", { email: "asha@example.com", password: "short" }],
    ["an overlong password", { email: "asha@example.com", password: "x".repeat(129) }],
    ["unknown keys", { email: "asha@example.com", password: PASSWORD, admin: true }],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await app.post("/api/auth/signup").send(body)).status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("returns a new session for the right password", async () => {
    const first = await signup(app, "asha");
    const res = await app.post("/api/auth/login").send({ email: "asha@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(first.id);
    expect(res.body.token).not.toBe(first.token);
    expect((await app.get("/api/auth/me").set(bearer(res.body.token))).status).toBe(200);
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    await signup(app, "asha");
    const wrong = await app.post("/api/auth/login").send({ email: "asha@example.com", password: "wrong password" });
    const unknown = await app.post("/api/auth/login").send({ email: "nobody@example.com", password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("upgrades a hash made with older scrypt parameters on the next successful login", async () => {
    const salt = randomBytes(16);
    const key = scryptSync(PASSWORD, salt, 64, { N: 2 ** 14, r: 8, p: 1 });
    const legacy = ["scrypt", 2 ** 14, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
    await pool.query("INSERT INTO users (email, password_hash) VALUES ('old@example.com', $1)", [legacy]);

    const res = await app.post("/api/auth/login").send({ email: "old@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE email = 'old@example.com'");
    expect(rows[0].password_hash).toMatch(/^scrypt\$131072\$8\$1\$/);

    const again = await app.post("/api/auth/login").send({ email: "old@example.com", password: PASSWORD });
    expect(again.status).toBe(200);
  });

  it("returns 401, not 500, when a stored hash is corrupt", async () => {
    await pool.query("INSERT INTO users (email, password_hash) VALUES ('bad@example.com', 'scrypt$abc$8$1$c2FsdA==$a2V5')");
    const res = await app.post("/api/auth/login").send({ email: "bad@example.com", password: PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe("sessions", () => {
  it.each([
    ["missing", {}],
    ["unknown", bearer("not-a-real-token")],
    ["not bearer", { Authorization: "Basic abc" }],
  ])("returns 401 when the token is %s", async (_label, headers) => {
    expect((await app.get("/api/auth/me").set(headers)).status).toBe(401);
  });

  it("logout revokes only that session", async () => {
    const asha = await signup(app, "asha");
    const other = await app.post("/api/auth/login").send({ email: "asha@example.com", password: PASSWORD });

    expect((await app.post("/api/auth/logout").set(asha.headers)).status).toBe(204);
    expect((await app.get("/api/auth/me").set(asha.headers)).status).toBe(401);
    expect((await app.get("/api/auth/me").set(bearer(other.body.token))).status).toBe(200);
  });

  it("rejects an expired session", async () => {
    const asha = await signup(app, "asha");
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await app.get("/api/auth/me").set(asha.headers)).status).toBe(401);
  });
});

describe("chats belong to their user", () => {
  it("requires sign-in for generate, conversations and feedback", async () => {
    expect((await app.post("/api/diagrams/generate").send({ prompt: "x".repeat(20), diagram_types: ["class"] })).status).toBe(401);
    expect((await app.get("/api/conversations")).status).toBe(401);
    expect((await app.get(`/api/conversations/${crypto.randomUUID()}`)).status).toBe(401);
    expect((await app.post(`/api/diagrams/${crypto.randomUUID()}/feedback`).send({ rating: 1 })).status).toBe(401);
  });

  it("stores each conversation under the signed-in user's id", async () => {
    const asha = await signup(app, "asha");
    const { conversation_id } = await generate(app, asha, { diagram_types: ["class"] });
    const { rows } = await pool.query("SELECT user_id FROM conversations WHERE id = $1", [conversation_id]);
    expect(rows).toEqual([{ user_id: asha.id }]);
  });

  it("lists only the user's own conversations, most recently updated first", async () => {
    const asha = await signup(app, "asha");
    const mallory = await signup(app, "mallory");
    const older = await generate(app, asha, { diagram_types: ["class"], prompt: "First design: a library system" });
    const newer = await generate(app, asha, { diagram_types: ["class"], prompt: "Second design: a parking garage" });
    await generate(app, mallory, { diagram_types: ["class"] });
    // A follow-up on the older conversation moves it to the top.
    await generate(app, asha, { conversation_id: older.conversation_id, diagram_types: ["class"] });

    const res = await app.get("/api/conversations").set(asha.headers);
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([
      older.conversation_id,
      newer.conversation_id,
    ]);
    expect(res.body.conversations[1]).toEqual({
      id: newer.conversation_id,
      title: "Second design: a parking garage",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("returns a conversation with every version to its owner, and 404 to anyone else", async () => {
    const asha = await signup(app, "asha");
    const mallory = await signup(app, "mallory");
    const { conversation_id } = await generate(app, asha, { diagram_types: ["sequence", "component"] });
    await generate(app, asha, { conversation_id, diagram_types: ["sequence"], prompt: "Add email alerts please" });

    const own = await app.get(`/api/conversations/${conversation_id}`).set(asha.headers);
    expect(own.status).toBe(200);
    expect(own.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(own.body.versions[0].diagrams).toHaveLength(2);

    expect((await app.get(`/api/conversations/${conversation_id}`).set(mallory.headers)).status).toBe(404);
  });

  it("does not let another user continue someone else's conversation", async () => {
    const asha = await signup(app, "asha");
    const mallory = await signup(app, "mallory");
    const { conversation_id } = await generate(app, asha, { diagram_types: ["class"] });

    const res = await app
      .post("/api/diagrams/generate")
      .set(mallory.headers)
      .send({ conversation_id, prompt: "Hijack this conversation", diagram_types: ["class"] });
    expect(res.status).toBe(404);
  });

  it("rejects a user_id in the body now that the user comes from the session", async () => {
    const asha = await signup(app, "asha");
    const res = await app
      .post("/api/diagrams/generate")
      .set(asha.headers)
      .send({ user_id: "someone-else", prompt: "A design with a spoofed user", diagram_types: ["class"] });
    expect(res.status).toBe(400);
  });
});
