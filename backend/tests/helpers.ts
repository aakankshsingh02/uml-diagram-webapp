import request from "supertest";
import { createApp } from "../src/app.js";
import { createContainer, type ContainerOverrides } from "../src/container.js";
import { pool } from "../src/db/pool.js";
import type { DiagramType } from "../src/schemas/diagram.schema.js";
import type { DiagramLlm } from "../src/services/llm.service.js";
import type { KrokiService } from "../src/services/kroki.service.js";

export const TRAINING_TOKEN = "test-training-token-0123456789abcdef";
export const auth = { Authorization: `Bearer ${TRAINING_TOKEN}` };

export const SEBI_PROMPT =
  "Compliance monitoring: pull the latest SEBI circulars, parse them into clauses, extract new requirements, run a gap analysis and assess IT/ops impact.";

/** Sources containing BROKEN fail to render; the fake repair turns BROKEN into FIXED unless UNFIXABLE. */
export function fakeLlm(sourceFor: (type: DiagramType) => string = () => "graph TD; A-->B"): DiagramLlm {
  return {
    async generateDiagrams(prompt, types) {
      const diagrams = types.map((type) => ({ type, title: `${type} view`, source: sourceFor(type) }));
      return {
        diagrams,
        trace: {
          model: "fake-model",
          messages: [
            { role: "system", content: "system prompt" },
            { role: "user", content: prompt },
            { role: "assistant", content: JSON.stringify({ diagrams }) },
          ],
          attempts: 1,
          latencyMs: 42,
        },
      };
    },
    async repairDiagram(_engine, source) {
      return source.includes("UNFIXABLE") ? source : source.replace("BROKEN", "FIXED");
    },
  };
}

export const fakeKroki: Pick<KrokiService, "renderSvg" | "isHealthy"> = {
  async renderSvg(engine, source) {
    return source.includes("BROKEN")
      ? { ok: false, error: `${engine}: syntax error`, retryable: false }
      : { ok: true, svg: `<svg data-engine="${engine}"></svg>` };
  },
  async isHealthy() {
    return true;
  },
};

export function testApp(overrides: ContainerOverrides = {}) {
  return request(createApp(createContainer({ llm: fakeLlm(), kroki: fakeKroki, ...overrides })));
}

export async function resetDb() {
  const { rows } = await pool.query<{ db: string }>("SELECT current_database() AS db");
  // TRUNCATE ... CASCADE is destructive; refuse anything that is not a dedicated test database.
  if (!rows[0]!.db.endsWith("_test")) throw new Error(`refusing to reset non-test database "${rows[0]!.db}"`);
  await pool.query("TRUNCATE users, sessions, conversations, messages, diagrams, generations, feedback CASCADE");
}

export const PASSWORD = "correct horse battery";

export interface TestUser {
  id: string;
  email: string;
  token: string;
  headers: { Authorization: string };
}

/** Registers `<name>@example.com` through the API and returns its session. */
export async function signup(app: ReturnType<typeof testApp>, name: string): Promise<TestUser> {
  const res = await app.post("/api/auth/signup").send({ email: `${name}@example.com`, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  const { token, user } = res.body as { token: string; user: { id: string; email: string } };
  return { ...user, token, headers: { Authorization: `Bearer ${token}` } };
}

export async function generate(
  app: ReturnType<typeof testApp>,
  user: TestUser,
  body: { diagram_types: string[]; conversation_id?: string; prompt?: string },
) {
  const res = await app.post("/api/diagrams/generate").set(user.headers).send({ prompt: SEBI_PROMPT, ...body });
  if (res.status !== 201) throw new Error(`generate failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as {
    conversation_id: string;
    version: number;
    diagrams: { id: string; type: DiagramType; engine: string; svg: string | null; render_error: string | null }[];
  };
}

export function parseNdjson(text: string) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
