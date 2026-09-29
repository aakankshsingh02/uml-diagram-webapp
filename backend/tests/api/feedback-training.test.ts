import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/pool.js";
import { auth, fakeKroki, fakeLlm, generate, parseNdjson, resetDb, signup, testApp, type TestUser } from "../helpers.js";

const app = testApp();
let asha: TestUser;
let mallory: TestUser;

beforeEach(async () => {
  await resetDb();
  asha = await signup(app, "asha");
  mallory = await signup(app, "mallory");
});
afterAll(() => pool.end());

async function exportLines(client = app) {
  const res = await client.get("/api/training/trajectories").set(auth);
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("application/x-ndjson");
  return { lines: parseNdjson(res.text), asOf: res.headers["x-export-as-of"] as string };
}

describe("POST /api/diagrams/:id/feedback", () => {
  it("stores a first rating and replaces it on re-rate, keeping the id", async () => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
    const url = `/api/diagrams/${diagrams[0]!.id}/feedback`;

    const first = await app.post(url).set(asha.headers).send({ rating: -1, comment: "missing fetcher" });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ id: expect.any(String), diagram_id: diagrams[0]!.id, rating: -1, comment: "missing fetcher" });

    const before = (await pool.query("SELECT updated_at FROM feedback")).rows[0].updated_at as Date;
    const second = await app.post(url).set(asha.headers).send({ rating: 1 });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, rating: 1, comment: null });

    const { rows } = await pool.query("SELECT rating, updated_at FROM feedback");
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(1);
    expect((rows[0].updated_at as Date).getTime()).toBeGreaterThan(before.getTime());
  });

  it("returns 404 for a user who does not own the conversation and writes nothing", async () => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
    const res = await app.post(`/api/diagrams/${diagrams[0]!.id}/feedback`).set(mallory.headers).send({ rating: 1 });
    expect(res.status).toBe(404);
    expect((await pool.query("SELECT 1 FROM feedback")).rowCount).toBe(0);
  });

  it("returns 404 for an unknown diagram", async () => {
    const res = await app
      .post(`/api/diagrams/${crypto.randomUUID()}/feedback`)
      .set(asha.headers).send({ rating: 1 });
    expect(res.status).toBe(404);
  });

  it.each([0, 2, "up", null])("rejects rating %s with 400", async (rating) => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
    const res = await app.post(`/api/diagrams/${diagrams[0]!.id}/feedback`).set(asha.headers).send({ rating });
    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors.rating).toBeDefined();
  });

  it("rejects unknown keys and oversized comments with 400", async () => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
    const url = `/api/diagrams/${diagrams[0]!.id}/feedback`;
    expect((await app.post(url).set(asha.headers).send({ rating: 1, extra: true })).status).toBe(400);
    expect((await app.post(url).set(asha.headers).send({ rating: 1, comment: "x".repeat(2001) })).status).toBe(400);
  });

  it("returns 400 for a malformed diagram id", async () => {
    const res = await app.post("/api/diagrams/not-a-uuid/feedback").set(asha.headers).send({ rating: 1 });
    expect(res.status).toBe(400);
  });
});

describe("generation capture", () => {
  it("persists one generation with system, user and assistant messages per generate call", async () => {
    const { conversation_id } = await generate(app, asha, { diagram_types: ["sequence", "component"] });
    await generate(app, asha, { conversation_id, diagram_types: ["sequence"], prompt: "Add email alerts for high-impact gaps" });

    const { rows } = await pool.query(
      "SELECT g.messages, g.attempts, g.latency_ms FROM generations g JOIN messages m ON m.id = g.message_id ORDER BY m.version",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(rows[0]).toMatchObject({ attempts: 1, latency_ms: 42 });
  });
});

describe("GET /api/training/trajectories", () => {
  it("returns an empty body when nothing is rated", async () => {
    await generate(app, asha, { diagram_types: ["sequence"] });
    const { lines, asOf } = await exportLines();
    expect(lines).toEqual([]);
    expect(Number.isNaN(Date.parse(asOf))).toBe(false);
  });

  it("exports a generation with one of two diagrams rated -1 as reward -0.5", async () => {
    const { diagrams, conversation_id } = await generate(app, asha, {
      diagram_types: ["sequence", "component"],
    });
    await app.post(`/api/diagrams/${diagrams[1]!.id}/feedback`).set(asha.headers).send({ rating: -1, comment: "missing fetcher" });

    const { lines } = await exportLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      reward: -0.5,
      metrics: { diagrams: 2, rated: 1, negative: 1 },
      metadata: {
        conversation_id,
        version: 1,
        model: "fake-model",
        feedback: [{ diagram_id: diagrams[1]!.id, type: "component", rating: -1, comment: "missing fetcher" }],
      },
    });
    expect(lines[0].messages_and_choices).toHaveLength(3);
  });

  it("scores a render failure as -1 even when rated +1", async () => {
    const broken = testApp({
      llm: fakeLlm((t) => (t === "sequence" ? "UNFIXABLE BROKEN" : "graph TD; A-->B")),
    });
    const { diagrams } = await generate(broken, asha, { diagram_types: ["sequence", "class"] });
    expect(diagrams[0]!.svg).toBeNull();
    await broken.post(`/api/diagrams/${diagrams[0]!.id}/feedback`).set(asha.headers).send({ rating: 1 });

    const { lines } = await exportLines(broken);
    expect(lines[0]).toMatchObject({ reward: -0.5, metrics: { render_failures: 1, positive: 1, repaired: 0 } });
    const { rows } = await pool.query("SELECT diagram_type, repaired FROM diagrams ORDER BY position");
    expect(rows[0]).toEqual({ diagram_type: "sequence", repaired: false });
  });

  it("omits acknowledged generations until their feedback changes", async () => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
    const feedbackUrl = `/api/diagrams/${diagrams[0]!.id}/feedback`;
    await app.post(feedbackUrl).set(asha.headers).send({ rating: -1 });

    const { lines, asOf } = await exportLines();
    const ack = await app.post("/api/training/trajectories/ack").set(auth).send({ ids: [lines[0].id], as_of: asOf });
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ acknowledged: 1 });
    expect((await exportLines()).lines).toEqual([]);

    await app.post(feedbackUrl).set(asha.headers).send({ rating: 1 });
    const again = await exportLines();
    expect(again.lines).toHaveLength(1);
    expect(again.lines[0].reward).toBe(1);
  });

  it("keeps feedback that changed between pull and ack exportable", async () => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
    const feedbackUrl = `/api/diagrams/${diagrams[0]!.id}/feedback`;
    await app.post(feedbackUrl).set(asha.headers).send({ rating: -1 });

    const { lines, asOf } = await exportLines();
    await app.post(feedbackUrl).set(asha.headers).send({ rating: 1 }); // lands after the pull
    await app.post("/api/training/trajectories/ack").set(auth).send({ ids: [lines[0].id], as_of: asOf });

    const after = await exportLines();
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0].reward).toBe(1);
  });

  it("honours limit and orders by generation creation", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
      await app.post(`/api/diagrams/${diagrams[0]!.id}/feedback`).set(asha.headers).send({ rating: 1 });
      ids.push(diagrams[0]!.id);
    }
    const res = await app.get("/api/training/trajectories?limit=2").set(auth);
    const lines = parseNdjson(res.text);
    expect(lines.map((l) => l.metadata.feedback[0].diagram_id)).toEqual(ids.slice(0, 2));
    expect((await app.get("/api/training/trajectories?limit=0").set(auth)).status).toBe(400);
    expect((await app.get("/api/training/trajectories?limit=1001").set(auth)).status).toBe(400);
  });
});

describe("training auth", () => {
  it.each([
    ["missing", {}],
    ["wrong", { Authorization: "Bearer nope" }],
    ["not bearer", { Authorization: "test-training-token-0123456789abcdef" }],
  ])("returns 401 when the token is %s", async (_label, headers) => {
    expect((await app.get("/api/training/trajectories").set(headers)).status).toBe(401);
    expect(
      (await app.post("/api/training/trajectories/ack").set(headers).send({ ids: [crypto.randomUUID()], as_of: new Date().toISOString() })).status,
    ).toBe(401);
  });

  it("returns 503 when the server has no token configured", async () => {
    const unconfigured = testApp({ trainingToken: "" });
    expect((await unconfigured.get("/api/training/trajectories").set(auth)).status).toBe(503);
  });

  it("validates the ack body", async () => {
    const post = (body: object) => app.post("/api/training/trajectories/ack").set(auth).send(body);
    expect((await post({ ids: [], as_of: new Date().toISOString() })).status).toBe(400);
    expect((await post({ ids: ["x"], as_of: new Date().toISOString() })).status).toBe(400);
    expect((await post({ ids: [crypto.randomUUID()] })).status).toBe(400);
  });
});

describe("review follow-ups", () => {
  it("records a successful repair and exports it as a -1 diagram with metrics.repaired", async () => {
    const repairing = testApp({ llm: fakeLlm((t) => (t === "sequence" ? "BROKEN seq" : "graph TD; A-->B")) });
    const { diagrams } = await generate(repairing, asha, { diagram_types: ["sequence", "class"] });
    expect(diagrams[0]!.svg).not.toBeNull();

    await repairing.post(`/api/diagrams/${diagrams[0]!.id}/feedback`).set(asha.headers).send({ rating: 1 });
    const { lines } = await exportLines(repairing);

    expect(lines[0]).toMatchObject({ reward: -0.5, metrics: { repaired: 1, render_failures: 0, positive: 1 } });
    const { rows } = await pool.query("SELECT diagram_type, repaired FROM diagrams ORDER BY position");
    expect(rows).toEqual([
      { diagram_type: "sequence", repaired: true },
      { diagram_type: "class", repaired: false },
    ]);
  });

  it("keeps request order in the conversation and in exported feedback", async () => {
    const order = ["sequence", "component", "class"];
    const { conversation_id, diagrams } = await generate(app, asha, { diagram_types: order });
    for (const d of diagrams) {
      await app.post(`/api/diagrams/${d.id}/feedback`).set(asha.headers).send({ rating: 1 });
    }

    const convo = await app.get(`/api/conversations/${conversation_id}`).set(asha.headers);
    expect(convo.body.versions[0].diagrams.map((d: { type: string }) => d.type)).toEqual(order);
    const { lines } = await exportLines();
    expect(lines[0].metadata.feedback.map((f: { type: string }) => f.type)).toEqual(order);
  });

  it("never moves the export watermark backwards or into the future", async () => {
    const { diagrams } = await generate(app, asha, { diagram_types: ["sequence"] });
    await app.post(`/api/diagrams/${diagrams[0]!.id}/feedback`).set(asha.headers).send({ rating: -1 });
    const { lines, asOf } = await exportLines();
    const ack = (as_of: string) =>
      app.post("/api/training/trajectories/ack").set(auth).send({ ids: [lines[0].id], as_of });
    const exportedAt = async () =>
      (await pool.query("SELECT exported_at::text AS t FROM generations")).rows[0].t as string;

    await ack(asOf);
    const acked = await exportedAt();
    await ack("2000-01-01T00:00:00Z"); // replayed, stale ack
    expect(await exportedAt()).toBe(acked);

    await ack("2999-01-01T00:00:00Z"); // bogus future ack is clamped to server time
    const { rows } = await pool.query("SELECT exported_at <= now() AS ok FROM generations");
    expect(rows[0].ok).toBe(true);
  });

  it("round-trips X-Export-As-Of with microsecond precision", async () => {
    const { asOf } = await exportLines();
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it("accepts a lower-case bearer scheme and returns 503 on ack without a configured token", async () => {
    expect((await app.get("/api/training/trajectories").set({ Authorization: "bearer test-training-token-0123456789abcdef" })).status).toBe(200);
    const unconfigured = testApp({ trainingToken: "" });
    const res = await unconfigured
      .post("/api/training/trajectories/ack")
      .set(auth)
      .send({ ids: [crypto.randomUUID()], as_of: new Date().toISOString() });
    expect(res.status).toBe(503);
  });

  it("retries a transient renderer failure instead of repairing a correct diagram", async () => {
    let calls = 0;
    const flaky = {
      ...fakeKroki,
      async renderSvg(engine: string) {
        calls += 1;
        return calls === 1
          ? { ok: false as const, error: "Kroki request failed: timeout", retryable: true }
          : { ok: true as const, svg: `<svg data-engine="${engine}"></svg>` };
      },
    };
    const llm = fakeLlm();
    const repair = vi.spyOn(llm, "repairDiagram");
    const client = testApp({ llm, kroki: flaky });

    const { diagrams } = await generate(client, asha, { diagram_types: ["sequence"] });

    expect(diagrams[0]!.svg).not.toBeNull();
    expect(repair).not.toHaveBeenCalled();
    const { rows } = await pool.query("SELECT repaired FROM diagrams");
    expect(rows[0].repaired).toBe(false);
  });
});
