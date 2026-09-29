import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Browser E2E with the API intercepted: exercises the real Next app, auth gate, chat,
 * rendering and rating without a backend, Groq or Kroki.
 */

const API = "http://localhost:4000/api";
const TOKEN = "e2e-session-token";
const USER = { id: "7b0e4b8e-2f1c-4c55-9a39-0d6f6c0f5a11", email: "asha@example.com", created_at: "2026-09-30T00:00:00.000Z" };
const CONVERSATION_ID = "0c7c2f7a-5a2b-4d4e-8f59-6a1d8f0e3b10";
const PROMPT =
  "Compliance monitoring: pull the latest SEBI circulars, parse clauses, extract new requirements, gap analysis and IT/ops impact.";

const svg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><text x="10" y="35">${label}</text></svg>`;
const DIAGRAMS = [
  { id: "11111111-1111-4111-8111-111111111111", type: "sequence", engine: "mermaid", title: "Circular ingestion flow", source: "sequenceDiagram\nA->>B: fetch", svg: svg("sequence"), render_error: null },
  { id: "22222222-2222-4222-8222-222222222222", type: "component", engine: "plantuml", title: "Compliance components", source: "@startuml\n[A]\n@enduml", svg: svg("component"), render_error: null },
];

interface MockApi {
  feedback: Request[];
  generate: Request[];
}

async function mockApi(page: Page): Promise<MockApi> {
  const seen: MockApi = { feedback: [], generate: [] };
  let conversations: object[] = [];
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api", "");
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const authed = req.headers()["authorization"] === `Bearer ${TOKEN}`;

    if (path === "/auth/signup") return json(201, { token: TOKEN, user: USER });
    if (!authed) return json(401, { error: "Unauthorized" });
    if (path === "/auth/me") return json(200, { user: USER });
    if (path === "/conversations") return json(200, { conversations });
    if (path === "/diagrams/generate") {
      seen.generate.push(req);
      conversations = [{ id: CONVERSATION_ID, title: PROMPT.slice(0, 80), created_at: USER.created_at, updated_at: USER.created_at }];
      return json(201, { conversation_id: CONVERSATION_ID, version: 1, diagrams: DIAGRAMS });
    }
    if (path === `/conversations/${CONVERSATION_ID}`) {
      return json(200, {
        id: CONVERSATION_ID,
        title: PROMPT.slice(0, 80),
        versions: [{ version: 1, prompt: PROMPT, diagram_types: ["sequence", "component"], created_at: USER.created_at, diagrams: DIAGRAMS }],
      });
    }
    const feedback = /^\/diagrams\/([^/]+)\/feedback$/.exec(path);
    if (feedback) {
      seen.feedback.push(req);
      const body = req.postDataJSON() as { rating: 1 | -1; comment?: string };
      return json(200, { id: "33333333-3333-4333-8333-333333333333", diagram_id: feedback[1], rating: body.rating, comment: body.comment ?? null });
    }
    return json(404, { error: "Route not found" });
  });
  return seen;
}

test("new user signs up, generates diagrams, rates one, and reopens the chat after reload", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/");

  // Sign up
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();

  // Generate (task case 1)
  await page.getByRole("textbox").first().fill(PROMPT);
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText("Version 1")).toBeVisible();
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Circular ingestion flow" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Compliance components" })).toBeVisible();

  const generateBody = api.generate[0]!.postDataJSON();
  expect(generateBody).toEqual({ prompt: PROMPT, diagram_types: ["sequence", "component"] });
  expect(api.generate[0]!.headers()["authorization"]).toBe(`Bearer ${TOKEN}`);

  // Rate the component diagram with a comment (task case 3)
  const component = cards.filter({ hasText: "Compliance components" });
  await component.getByRole("textbox", { name: "Comment (optional)" }).fill("missing SEBI fetcher");
  await component.getByRole("button", { name: "Rate not helpful" }).click();
  await expect(component.getByText("Thanks — feedback saved")).toBeVisible();
  await expect(component.getByRole("button", { name: "Rate not helpful" })).toHaveAttribute("aria-pressed", "true");
  expect(api.feedback).toHaveLength(1);
  expect(new URL(api.feedback[0]!.url()).pathname).toBe(`/api/diagrams/${DIAGRAMS[1]!.id}/feedback`);
  expect(api.feedback[0]!.postDataJSON()).toEqual({ rating: -1, comment: "missing SEBI fetcher" });

  // Reload: the session and the conversation survive (task case 2, returning user)
  await page.reload();
  await expect(page.getByRole("heading", { name: "UML Chat" })).toBeVisible();
  const chats = page.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: new RegExp(PROMPT.slice(0, 30)) }).click();
  await expect(page.getByRole("img", { name: "Compliance components" })).toBeVisible();
});

test("a failed rating shows the error and does not stay selected", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript((token) => localStorage.setItem("uml.sessionToken", token), TOKEN);
  await page.route(`${API}/diagrams/*/feedback`, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal server error" }) }),
  );
  await page.goto("/");

  await page.getByRole("textbox").first().fill(PROMPT);
  await page.getByRole("button", { name: "Generate" }).click();
  const card = page.getByRole("article").filter({ hasText: "Circular ingestion flow" });
  await card.getByRole("button", { name: "Rate helpful" }).click();

  await expect(card.getByRole("alert")).toHaveText("Internal server error");
  await expect(card.getByRole("button", { name: "Rate helpful" })).toHaveAttribute("aria-pressed", "false");
});
