import { describe, expect, it } from "vitest";
import { ArchitectureModelSchema } from "../../src/schemas/architecture.schema.js";
import { checkConsistency } from "../../src/services/consistency.js";

describe("checkConsistency", () => {
  const diagrams = [
    { type: "class" as const, source: "classDiagram\nclass CircularFetcher" },
    { type: "use_case" as const, source: "@startuml\nactor User\n@enduml" },
  ];

  it("accepts a first version (nothing to compare against)", () => {
    expect(checkConsistency(diagrams)).toEqual([]);
    expect(checkConsistency(diagrams, [])).toEqual([]);
  });

  it("flags an update that returns every diagram unchanged, ignoring whitespace", () => {
    const previous = diagrams.map((d) => ({ ...d, source: `${d.source.replace("\n", "\n   ")}\n` }));
    expect(checkConsistency(diagrams, previous).join(" ")).toContain("identical to the previous version");
  });

  it("accepts an update when a new type was added or any diagram changed", () => {
    const previous = diagrams.map((d) => ({ ...d }));
    const withNewType = [...diagrams, { type: "activity" as const, source: "flowchart TD\nA-->B" }];
    expect(checkConsistency(withNewType, previous)).toEqual([]);
    const changed = [diagrams[0]!, { ...diagrams[1]!, source: "@startuml\nactor Officer\n@enduml" }];
    expect(checkConsistency(changed, previous)).toEqual([]);
  });
});

describe("ArchitectureModelSchema", () => {
  const messagesOf = (input: unknown) => {
    const result = ArchitectureModelSchema.safeParse(input);
    expect(result.success).toBe(false);
    return result.error!.issues.map((i) => i.message).join(" | ");
  };

  it("rejects duplicate names, unknown endpoints and isolated elements", () => {
    const messages = messagesOf({
      elements: [
        { name: "User", kind: "actor", description: "x" },
        { name: "user", kind: "service", description: "dup" },
        { name: "Lonely", kind: "service", description: "no interactions" },
      ],
      interactions: [{ from: "User", to: "Ghost", message: "hi" }],
    });
    expect(messages).toContain("duplicate element name");
    expect(messages).toContain('"Ghost" is not an element');
    expect(messages).toContain('"Lonely" takes part in no interaction');
  });

  it("rejects names that aren't identifiers (data like 'Clause Table')", () => {
    const messages = messagesOf({
      elements: [
        { name: "User", kind: "actor", description: "x" },
        { name: "Clause Table", kind: "datastore", description: "space in name" },
      ],
      interactions: [{ from: "User", to: "Clause Table", message: "hi" }],
    });
    expect(messages).toContain("must be an identifier");
  });
});
