import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/pool.js";
import { FAKE_ARCHITECTURE, fakeLlm, generate, resetDb, SEBI_PROMPT, signup, testApp, type TestUser } from "../helpers.js";

const app = testApp();
let asha: TestUser;
let mallory: TestUser;

beforeEach(async () => {
  await resetDb();
  asha = await signup(app, "asha");
  mallory = await signup(app, "mallory");
});
afterAll(() => pool.end());

describe("GET /api/health", () => {
  it("reports database, renderer and model status", async () => {
    const res = await app.get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, database: true, kroki: true, llm_configured: true });
  });

  it("returns 503 when the renderer is down", async () => {
    const down = testApp({ kroki: { renderSvg: vi.fn(), isHealthy: async () => false } });
    const res = await down.get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, kroki: false });
  });
});

describe("POST /api/diagrams/generate", () => {
  it("creates version 1 with one rendered diagram per requested type, in request order (task case 1)", async () => {
    const res = await app
      .post("/api/diagrams/generate")
      .set(asha.headers)
      .send({ prompt: SEBI_PROMPT, diagram_types: ["sequential", "component", "use-case", "State"] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ conversation_id: expect.any(String), version: 1 });
    expect(res.body.diagrams.map((d: { type: string; engine: string }) => [d.type, d.engine])).toEqual([
      ["sequence", "mermaid"],
      ["component", "plantuml"],
      ["use_case", "plantuml"],
      ["state_machine", "mermaid"],
    ]);
    for (const d of res.body.diagrams) {
      expect(d).toEqual({
        id: expect.any(String),
        type: expect.any(String),
        engine: expect.any(String),
        title: expect.any(String),
        source: expect.any(String),
        svg: expect.stringContaining("<svg"),
        render_error: null,
      });
    }
  });

  it("collapses duplicate diagram types", async () => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence", "sequential", "Sequence"] });
    expect(diagrams).toHaveLength(1);
  });

  it("revises the previous architecture on an update and returns version 2 (task case 2)", async () => {
    const llm = fakeLlm();
    const design = vi.spyOn(llm, "designArchitecture");
    const draw = vi.spyOn(llm, "generateDiagrams");
    const client = testApp({ llm });

    const first = await generate(client, asha, { diagram_types: ["sequence"] });
    const second = await generate(client, asha, {
      conversation_id: first.conversation_id,
      prompt: "Also email the compliance officer when a high-impact gap is found",
      diagram_types: ["sequence", "use_case"],
    });

    expect(second).toMatchObject({ conversation_id: first.conversation_id, version: 2 });
    expect(design.mock.calls[0]![1]).toBeUndefined();
    const previous = {
      prompt: SEBI_PROMPT,
      architecture: FAKE_ARCHITECTURE,
      diagrams: [{ type: "sequence", title: "sequence view", source: "graph TD; A-->B" }],
    };
    expect(design.mock.calls[1]![1]).toEqual(previous);
    // Diagrams are drawn from the (revised) model, with the previous version for the unchanged-output check.
    expect(draw.mock.calls[1]![2]).toEqual(FAKE_ARCHITECTURE);
    expect(draw.mock.calls[1]![3]).toEqual(previous);
  });

  it("stores the architecture model on each version", async () => {
    const { conversation_id } = await generate(app, asha, { diagram_types: ["sequence"] });
    const { rows } = await pool.query("SELECT architecture FROM messages WHERE conversation_id = $1", [conversation_id]);
    expect(rows[0].architecture).toEqual(FAKE_ARCHITECTURE);
  });

  it("returns 404 and persists nothing for another user's conversation", async () => {
    const { conversation_id } = await generate(app, asha, { diagram_types: ["sequence"] });
    const before = (await pool.query("SELECT count(*)::int AS n FROM messages")).rows[0].n;

    const res = await app
      .post("/api/diagrams/generate")
      .set(mallory.headers)
      .send({ conversation_id, prompt: SEBI_PROMPT, diagram_types: ["class"] });

    expect(res.status).toBe(404);
    expect((await pool.query("SELECT count(*)::int AS n FROM messages")).rows[0].n).toBe(before);
  });

  it.each([
    ["prompt too short", { prompt: "short", diagram_types: ["class"] }, "prompt"],
    ["no diagram types", { prompt: SEBI_PROMPT, diagram_types: [] }, "diagram_types"],
    ["unknown diagram type", { prompt: SEBI_PROMPT, diagram_types: ["flowchart"] }, "diagram_types"],
    ["malformed conversation id", { prompt: SEBI_PROMPT, diagram_types: ["class"], conversation_id: "x" }, "conversation_id"],
  ])("returns 400 for %s", async (_label, body, field) => {
    const res = await app.post("/api/diagrams/generate").set(asha.headers).send(body);
    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors[field]).toBeDefined();
  });

  it("rejects unknown keys such as the removed user_id", async () => {
    const res = await app
      .post("/api/diagrams/generate")
      .set(asha.headers)
      .send({ user_id: "asha", prompt: SEBI_PROMPT, diagram_types: ["class"] });
    expect(res.status).toBe(400);
    expect(res.body.details.formErrors.join(" ")).toContain("user_id");
  });

  it("returns 400 for malformed JSON and 401 without a session", async () => {
    const bad = await app
      .post("/api/diagrams/generate")
      .set(asha.headers)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(bad.status).toBe(400);

    const anon = await app.post("/api/diagrams/generate").send({ prompt: SEBI_PROMPT, diagram_types: ["class"] });
    expect(anon.status).toBe(401);
  });

  it("returns 503 when no model is configured", async () => {
    const { LlmService } = await import("../../src/services/llm.service.js");
    const noModel = testApp({ llm: new LlmService("", "m") });
    const res = await noModel.post("/api/diagrams/generate").set(asha.headers).send({ prompt: SEBI_PROMPT, diagram_types: ["class"] });
    expect(res.status).toBe(503);
  });

  it("returns the source and render error when a diagram cannot be rendered even after repair", async () => {
    const broken = testApp({ llm: fakeLlm(() => "UNFIXABLE BROKEN") });
    const { diagrams } = await generate(broken, asha, { diagram_types: ["timing"] });
    expect(diagrams[0]).toMatchObject({ svg: null, render_error: "plantuml: syntax error" });
  });
});

describe("GET /api/conversations", () => {
  it("lists only the caller's conversations, most recently updated first", async () => {
    const older = await generate(app, asha, { diagram_types: ["class"] });
    const newer = await generate(app, asha, { diagram_types: ["class"] });
    await generate(app, mallory, { diagram_types: ["class"] });
    await generate(app, asha, { conversation_id: older.conversation_id, diagram_types: ["class"] });

    const res = await app.get("/api/conversations").set(asha.headers);

    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([
      older.conversation_id,
      newer.conversation_id,
    ]);
    expect(res.body.conversations[0]).toEqual({
      id: older.conversation_id,
      title: SEBI_PROMPT.slice(0, 80),
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("returns every version with its diagrams, and 404/400/401 for bad access", async () => {
    const first = await generate(app, asha, { diagram_types: ["sequence", "class"] });
    await generate(app, asha, { conversation_id: first.conversation_id, diagram_types: ["sequence"], prompt: "Add alerts for gaps" });

    const res = await app.get(`/api/conversations/${first.conversation_id}`).set(asha.headers);
    expect(res.status).toBe(200);
    expect(res.body.versions.map((v: { version: number; diagrams: unknown[] }) => [v.version, v.diagrams.length])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(res.body.versions[1].prompt).toBe("Add alerts for gaps");

    expect((await app.get(`/api/conversations/${first.conversation_id}`).set(mallory.headers)).status).toBe(404);
    expect((await app.get(`/api/conversations/${crypto.randomUUID()}`).set(asha.headers)).status).toBe(404);
    expect((await app.get("/api/conversations/not-a-uuid").set(asha.headers)).status).toBe(400);
    expect((await app.get(`/api/conversations/${first.conversation_id}`)).status).toBe(401);
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404", async () => {
    const res = await app.get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Route not found" });
  });
});
