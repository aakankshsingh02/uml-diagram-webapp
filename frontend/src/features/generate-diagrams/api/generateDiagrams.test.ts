import { describe, expect, it } from "vitest";
import { mockFetch } from "@test/mock-fetch";
import { generateDiagrams } from "./generateDiagrams";

describe("generateDiagrams", () => {
  it("sends only prompt, diagram types and the optional conversation id", async () => {
    const conversationId = "0c7c2f7a-5a2b-4d4e-8f59-6a1d8f0e3b10";
    const calls = mockFetch({
      status: 201,
      body: { conversation_id: conversationId, version: 2, diagrams: [] },
    });

    await generateDiagrams({
      conversation_id: conversationId,
      prompt: "Add a notifier for high-impact gaps",
      diagram_types: ["sequence"],
    });

    expect(calls[0]!.body).toEqual({
      conversation_id: conversationId,
      prompt: "Add a notifier for high-impact gaps",
      diagram_types: ["sequence"],
    });
    expect(calls[0]!.body).not.toHaveProperty("user_id");
  });
});
