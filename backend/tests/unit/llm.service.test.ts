import type Groq from "groq-sdk";
import { describe, expect, it, vi } from "vitest";
import type { ArchitectureModel } from "../../src/schemas/architecture.schema.js";
import { LlmService } from "../../src/services/llm.service.js";

function fakeGroq(...contents: string[]) {
  const create = vi.fn();
  for (const content of contents) create.mockResolvedValueOnce({ choices: [{ message: { content } }] });
  return { client: { chat: { completions: { create } } } as unknown as Groq, create };
}

const MODEL: ArchitectureModel = {
  elements: [
    { name: "A", kind: "actor", description: "caller" },
    { name: "B", kind: "service", description: "callee" },
  ],
  interactions: [{ from: "A", to: "B", message: "hi" }],
};

const classDiagram = (source: string) => JSON.stringify({ diagrams: [{ type: "class", title: "Types", source }] });
const SOURCE = "classDiagram\nclass A\nclass B\nA --> B";
const valid = classDiagram(SOURCE);
const previous = {
  prompt: "old",
  architecture: MODEL,
  diagrams: [{ type: "class" as const, title: "Types", source: SOURCE }],
};

describe("LlmService.generateDiagrams trace", () => {
  it("records only the reply that passed validation, with the attempt count", async () => {
    const invalid = JSON.stringify({ diagrams: [{ type: "class", title: "Types", source: "x", extra: 1 }] });
    const { client, create } = fakeGroq(invalid, valid);

    const { diagrams, trace } = await new LlmService("", "test-model", client).generateDiagrams(
      "Design a SEBI circular monitor",
      ["class"],
      MODEL,
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(diagrams).toEqual([{ type: "class", title: "Types", source: SOURCE }]);
    expect(trace.attempts).toBe(2);
    expect(trace.issues).toEqual([]);
    expect(trace.model).toBe("test-model");
    expect(trace.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(trace.messages[2]!.content).toBe(valid);
    expect(trace.messages[1]!.content).toContain("Design a SEBI circular monitor");
    expect(trace.messages[0]!.content).toContain('"name":"B"'); // the model is in the prompt
  });

  it("flags an update that returns the previous diagrams unchanged", async () => {
    const { client, create } = fakeGroq(valid, classDiagram("classDiagram\nclass A\nclass B\nclass Alert"));

    const { trace } = await new LlmService("", "m", client).generateDiagrams("add alerts", ["class"], MODEL, previous);

    expect(trace.attempts).toBe(2);
    expect(trace.issues).toEqual([]);
    expect(create.mock.calls[1]![0].messages.at(-1).content).toContain("identical to the previous version");
    expect(create.mock.calls[0]![0].messages[1].content).not.toContain("A --> B"); // previous diagrams aren't echoed into the prompt
  });

  it("accepts the last valid reply with its issues instead of failing when it stays unchanged", async () => {
    const { client, create } = fakeGroq(valid, valid, valid);

    const { diagrams, trace } = await new LlmService("", "m", client).generateDiagrams("add alerts", ["class"], MODEL, previous);

    expect(create).toHaveBeenCalledTimes(3);
    expect(diagrams).toHaveLength(1);
    expect(trace.issues.join(" ")).toContain("identical to the previous version");
  });

  it("fails with 502 after two schema failures (the extra attempt is only for consistency feedback)", async () => {
    const { client, create } = fakeGroq("not json", JSON.stringify({ diagrams: [] }), "never requested");
    await expect(
      new LlmService("", "m", client).generateDiagrams("prompt text", ["class"], MODEL),
    ).rejects.toMatchObject({ status: 502 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last schema-valid reply when later attempts break the schema", async () => {
    const { client, create } = fakeGroq(valid, "not json", "still not json");

    const { trace } = await new LlmService("", "m", client).generateDiagrams("add alerts", ["class"], MODEL, previous);

    expect(create).toHaveBeenCalledTimes(3);
    expect(trace.attempts).toBe(3); // every call made, not the index of the accepted reply
    expect(trace.messages[2]!.content).toBe(valid);
    expect(trace.issues.length).toBeGreaterThan(0);
  });

  it("reports 503 when no API key or client is configured", async () => {
    await expect(new LlmService("", "m").generateDiagrams("prompt text", ["class"], MODEL)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("LlmService.designArchitecture", () => {
  const reply = (architecture: unknown) => JSON.stringify({ architecture });

  it("retries when an interaction references an unknown element", async () => {
    const bad = { ...MODEL, interactions: [{ from: "A", to: "Ghost", message: "hi" }] };
    const { client, create } = fakeGroq(reply(bad), reply(MODEL));

    const { architecture, trace } = await new LlmService("", "arch-model", client).designArchitecture("prompt");

    expect(architecture).toEqual(MODEL);
    expect(create.mock.calls[1]![0].messages.at(-1).content).toContain('"Ghost" is not an element');
    // Its own RL trace: the accepted reply only, every call counted, no consistency issues.
    expect(trace).toMatchObject({ model: "arch-model", attempts: 2, issues: [] });
    expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
    expect(trace.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(trace.messages[1]!.content).toContain("prompt");
    expect(trace.messages[2]!.content).toBe(reply(MODEL));
  });

  it("revises the previous model on an update", async () => {
    const { client, create } = fakeGroq(reply(MODEL));

    await new LlmService("", "m", client).designArchitecture("add alerts", {
      prompt: "old requirements",
      architecture: MODEL,
      diagrams: [],
    });

    const user = create.mock.calls[0]![0].messages[1].content as string;
    expect(user).toContain("Current architecture:");
    expect(user).toContain("add alerts");
  });

  it("builds a fresh model from the previous diagrams when the version predates architecture models", async () => {
    const { client, create } = fakeGroq(reply(MODEL));

    await new LlmService("", "m", client).designArchitecture("make them consistent", {
      prompt: "old requirements",
      architecture: null,
      diagrams: [{ type: "sequence", title: "Flow", source: "sequenceDiagram\nA->>B: hi" }],
    });

    const user = create.mock.calls[0]![0].messages[1].content as string;
    expect(user).toContain("Previous diagrams");
    expect(user).toContain("Change request:\nmake them consistent");
    expect(user).not.toContain("Current architecture");
  });

  it("fails with 502 after two invalid models", async () => {
    const { client } = fakeGroq(reply({ elements: [] }), "not json");
    await expect(new LlmService("", "m", client).designArchitecture("prompt")).rejects.toMatchObject({ status: 502 });
  });
});
