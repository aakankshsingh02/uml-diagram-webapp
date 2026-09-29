import { expect, test } from "@playwright/test";

/**
 * Full-stack E2E: real API, Postgres, Kroki and Groq. Opt-in because it spends a model call:
 *   E2E_FULLSTACK=1 E2E_TRAINING_TOKEN=<backend TRAINING_API_TOKEN> npx playwright test fullstack
 * Proves task.md's loop: prompt → rendered UML → user feedback → ART trajectory export.
 */

const API = process.env.E2E_API_URL ?? "http://localhost:4000/api";
const TRAINING_TOKEN = process.env.E2E_TRAINING_TOKEN ?? "";

test.skip(!process.env.E2E_FULLSTACK, "set E2E_FULLSTACK=1 to run against the real stack");

test("SEBI prompt → sequence + component UML → thumbs-down → exported ART trajectory", async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await page
    .getByRole("textbox")
    .first()
    .fill(
      "I am working on a compliance monitoring solution which will pull in the latest circulars from SEBI and parse them. " +
        "Once parsed into a table of clauses, extract: 1. new compliance requirements, 2. gap analysis with my existing compliance setup, " +
        "3. impact on my organization at an IT and operational level.",
    );
  const generated = page.waitForResponse((r) => r.url().endsWith("/api/diagrams/generate"));
  await page.getByRole("button", { name: "Generate" }).click();
  const { conversation_id } = (await (await generated).json()) as { conversation_id: string };

  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(2, { timeout: 90_000 });
  for (const card of await cards.all()) {
    await expect(card.getByRole("img")).toBeVisible();
  }

  const second = cards.nth(1);
  await second.getByRole("textbox", { name: "Comment (optional)" }).fill("missing the SEBI circular fetcher");
  await second.getByRole("button", { name: "Rate not helpful" }).click();
  await expect(second.getByText("Thanks — feedback saved")).toBeVisible();

  test.skip(!TRAINING_TOKEN, "set E2E_TRAINING_TOKEN to verify the trainer export");
  const res = await request.get(`${API}/training/trajectories?limit=1000`, {
    headers: { Authorization: `Bearer ${TRAINING_TOKEN}` },
  });
  expect(res.status()).toBe(200);
  const lines = (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { reward: number; messages_and_choices: { role: string }[]; metadata: { conversation_id: string; feedback: { rating: number; comment: string }[] } });
  const trajectory = lines.find((l) => l.metadata.conversation_id === conversation_id);

  expect(trajectory).toBeDefined();
  expect(trajectory!.reward).toBeLessThan(0);
  expect(trajectory!.messages_and_choices.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  expect(trajectory!.metadata.feedback).toEqual([
    expect.objectContaining({ rating: -1, comment: "missing the SEBI circular fetcher" }),
  ]);
});
