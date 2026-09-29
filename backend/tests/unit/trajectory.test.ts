import { describe, expect, it } from "vitest";
import type { ExportDiagram, ExportableGeneration } from "../../src/repositories/generation.repository.js";
import { toTrajectory } from "../../src/services/training.service.js";

const diagram = (overrides: Partial<ExportDiagram> = {}): ExportDiagram => ({
  diagram_id: crypto.randomUUID(),
  type: "sequence",
  engine: "mermaid",
  rendered: true,
  repaired: false,
  rating: null,
  comment: null,
  ...overrides,
});

const generation = (diagrams: ExportDiagram[]): ExportableGeneration => ({
  id: "gen-1",
  message_id: "msg-1",
  conversation_id: "conv-1",
  version: 1,
  model: "m",
  messages: [
    { role: "system", content: "s" },
    { role: "user", content: "u" },
    { role: "assistant", content: "a" },
  ],
  attempts: 2,
  latency_ms: 1234,
  created_at: new Date("2026-09-30T10:00:00Z"),
  diagrams,
});

describe("toTrajectory reward", () => {
  it("one of two diagrams rated -1 gives -0.5", () => {
    const t = toTrajectory(generation([diagram({ rating: -1, comment: "missing fetcher" }), diagram()]));
    expect(t.reward).toBe(-0.5);
    expect(t.metrics).toMatchObject({ diagrams: 2, rated: 1, negative: 1, positive: 0 });
    expect(t.metadata.feedback).toEqual([expect.objectContaining({ rating: -1, comment: "missing fetcher" })]);
  });

  it("a render failure scores -1 even when rated +1", () => {
    const t = toTrajectory(generation([diagram({ rendered: false, rating: 1 }), diagram({ rating: 1 })]));
    expect(t.reward).toBe(0);
    expect(t.metrics.render_failures).toBe(1);
  });

  it("scores a diagram that only rendered after repair as -1, whatever its rating", () => {
    const t = toTrajectory(generation([diagram({ repaired: true, rating: 1 }), diagram({ rating: 1 })]));
    expect(t.reward).toBe(0);
    expect(t.metrics).toMatchObject({ repaired: 1, positive: 2, render_failures: 0 });
  });

  it("rounds to 3 decimals and maps ART fields", () => {
    const t = toTrajectory(generation([diagram({ rating: 1 }), diagram(), diagram(), diagram({ repaired: true })]));
    expect(t.reward).toBe(0);
    expect(toTrajectory(generation([diagram({ rating: 1 }), diagram(), diagram()])).reward).toBe(0.333);
    expect(t.group_id).toBe("msg-1");
    expect(t.messages_and_choices.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(t.metrics).toMatchObject({ repaired: 1, attempts: 2, latency_ms: 1234 });
    expect(t.metadata.created_at).toBe("2026-09-30T10:00:00.000Z");
  });
});
