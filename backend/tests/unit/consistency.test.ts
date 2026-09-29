import { describe, expect, it } from "vitest";
import { ArchitectureModelSchema, type ArchitectureModel } from "../../src/schemas/architecture.schema.js";
import { checkConsistency, extractNames } from "../../src/services/consistency.js";

const MODEL: ArchitectureModel = {
  elements: [
    { name: "User", kind: "actor", description: "Compliance officer" },
    { name: "CircularFetcher", kind: "service", description: "Pulls SEBI circulars" },
    { name: "ComplianceStore", kind: "datastore", description: "Existing compliance setup" },
  ],
  interactions: [
    { from: "User", to: "CircularFetcher", message: "start monitoring" },
    { from: "CircularFetcher", to: "ComplianceStore", message: "save clause table" },
  ],
};

const SEQUENCE = [
  "sequenceDiagram",
  "    actor User",
  "    participant CircularFetcher",
  "    participant ComplianceStore",
  "    User->>CircularFetcher: start monitoring",
  "    CircularFetcher->>+ComplianceStore: save clause table",
].join("\n");

const COMPONENT = [
  "@startuml",
  'package "Ingestion" {',
  "  actor User",
  "  component CircularFetcher",
  "}",
  'database "Compliance Store" as ComplianceStore',
  "User --> [CircularFetcher] : start",
  "[CircularFetcher] --> ComplianceStore : clause table",
  "@enduml",
].join("\n");

describe("extractNames", () => {
  it("reads Mermaid participants, aliases and message endpoints", () => {
    const names = extractNames("sequence", "sequenceDiagram\nparticipant F as CircularFetcher\nUser->>F: go");
    expect(names).toEqual([
      { id: "F", label: "CircularFetcher" },
      { id: "User" },
      { id: "F", label: "CircularFetcher" }, // bare alias resolved to its declared label
    ]);
  });

  it("reads PlantUML brackets, keyword elements with aliases and bare arrow endpoints, not packages", () => {
    const ids = extractNames("component", COMPONENT).map((n) => n.id);
    expect(new Set(ids)).toEqual(new Set(["User", "CircularFetcher", "ComplianceStore"]));
    expect(ids).not.toContain("Ingestion");
  });

  const ids = (source: string) => new Set(extractNames("component", `@startuml\n${source}\n@enduml`).map((n) => n.label ?? n.id));

  it("ignores arrow styles and bracketed text in labels", () => {
    expect(ids("[A] -[hidden]-> [B]\n[A] -[#red,dashed]-> [B] : save [ClauseTable]")).toEqual(new Set(["A", "B"]));
  });

  it("keeps a plain link to a bracketed component", () => {
    expect(ids("[A]--[B]")).toEqual(new Set(["A", "B"]));
  });

  it("treats interfaces as ports, not elements, including when arrows use them", () => {
    expect(ids('[Service] - Api\n() "REST" as Rest\nRest --> [Service]\ninterface Api')).toEqual(new Set(["Service"]));
  });

  it("skips multi-line note and legend bodies, but not one-line notes' targets", () => {
    const source = [
      "note right of [A]",
      "  Daily - batch run [nightly]",
      "end note",
      "legend",
      "  Key - value",
      "endlegend",
      "[A] --> [B]",
      "note left of B : a one-line note",
    ].join("\n");
    expect(ids(source)).toEqual(new Set(["A", "B"]));
  });

  it("resolves bracket and quoted aliases", () => {
    const names = extractNames(
      "component",
      "@startuml\ncomponent [Circular Fetcher] as CF\nparticipant L as \"Long Name\"\nCF --> L\n@enduml",
    );
    expect(names).toContainEqual({ id: "CF", label: "Circular Fetcher" });
    expect(names).toContainEqual({ id: "L", label: "Long Name" });
    expect(names.filter((n) => !n.label)).toEqual([]);
  });

  it("doesn't skip an element whose name matches a lowercase keyword (Node, End)", () => {
    expect(ids("[Node] --> End")).toEqual(new Set(["Node", "End"]));
  });
});

describe("checkConsistency", () => {
  const diagrams = [
    { type: "sequence" as const, source: SEQUENCE },
    { type: "component" as const, source: COMPONENT },
  ];

  it("accepts diagrams that use exactly the model's elements", () => {
    expect(checkConsistency(diagrams, MODEL)).toEqual([]);
  });

  it("flags data modelled as a component and an invented orchestrator", () => {
    const issues = checkConsistency(
      [{ type: "component", source: COMPONENT.replace("@enduml", "[ClauseTable] --> [CircularFetcher]\n@enduml") }],
      MODEL,
    );
    expect(issues.join(" ")).toContain("not architecture elements: ClauseTable");
  });

  it("flags elements missing from a view (the 8-vs-14 mismatch)", () => {
    const issues = checkConsistency([{ type: "sequence", source: SEQUENCE.replace(/.*ComplianceStore.*\n?/g, "") }], MODEL);
    expect(issues.join(" ")).toContain("missing architecture elements: ComplianceStore");
  });

  it("accepts an aliased participant whose label is the element name", () => {
    const aliased = SEQUENCE.replace("participant CircularFetcher", "participant F as CircularFetcher").replace(
      /CircularFetcher(->>|:)/g,
      "F$1",
    );
    expect(checkConsistency([{ type: "sequence", source: aliased }], MODEL)).toEqual([]);
  });

  it("says so when nothing is recognised, instead of listing every element as missing", () => {
    const issues = checkConsistency([{ type: "sequence", source: "sequenceDiagram" }], MODEL);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("no participants/components recognised");
  });

  it("doesn't name-check diagram types outside the checked set", () => {
    expect(checkConsistency([{ type: "class", source: "classDiagram\nclass Anything" }], MODEL)).toEqual([]);
    expect(checkConsistency([{ type: "deployment", source: "@startuml\nnode Server\n@enduml" }], MODEL)).toEqual([]);
  });

  it("flags an update that returns every diagram unchanged, but not when a new type was added", () => {
    const previous = diagrams.map((d) => ({ ...d }));
    expect(checkConsistency(diagrams, MODEL, previous).join(" ")).toContain("identical to the previous version");
    const withNewType = [...diagrams, { type: "class" as const, source: "classDiagram\nclass CircularFetcher" }];
    expect(checkConsistency(withNewType, MODEL, previous)).toEqual([]);
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
