import type Groq from "groq-sdk";
import { describe, expect, it, vi } from "vitest";
import { LlmService } from "../../src/services/llm.service.js";

function fakeGroq(...contents: string[]) {
  const create = vi.fn();
  for (const content of contents) create.mockResolvedValueOnce({ choices: [{ message: { content } }] });
  return { client: { chat: { completions: { create } } } as unknown as Groq, create };
}

const valid = JSON.stringify({ diagrams: [{ type: "sequence", title: "Flow", source: "sequenceDiagram\nA->>B: hi" }] });

describe("LlmService.generateDiagrams trace", () => {
  it("records only the reply that passed validation, with the attempt count", async () => {
    const invalid = JSON.stringify({ diagrams: [{ type: "sequence", title: "Flow", source: "x", extra: 1 }] });
    const { client, create } = fakeGroq(invalid, valid);

    const { diagrams, trace } = await new LlmService("", "test-model", client).generateDiagrams(
      "Design a SEBI circular monitor",
      ["sequence"],
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(diagrams).toEqual([{ type: "sequence", title: "Flow", source: "sequenceDiagram\nA->>B: hi" }]);
    expect(trace.attempts).toBe(2);
    expect(trace.model).toBe("test-model");
    expect(trace.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(trace.messages[2]!.content).toBe(valid);
    expect(trace.messages[1]!.content).toContain("Design a SEBI circular monitor");
    expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails with 502 after two invalid replies and never returns a trace", async () => {
    const { client } = fakeGroq("not json", JSON.stringify({ diagrams: [] }));
    await expect(new LlmService("", "m", client).generateDiagrams("prompt text", ["sequence"])).rejects.toMatchObject({
      status: 502,
    });
  });

  it("reports 503 when no API key or client is configured", async () => {
    await expect(new LlmService("", "m").generateDiagrams("prompt text", ["sequence"])).rejects.toMatchObject({
      status: 503,
    });
  });
});
