import { describe, expect, it } from "vitest";
import type { ArchitectureModel } from "../../src/schemas/architecture.schema.js";
import { projectDiagram } from "../../src/services/projection.js";

const MODEL: ArchitectureModel = {
  elements: [
    { name: "User", kind: "actor", description: "Compliance officer" },
    { name: "CircularFetcher", kind: "service", description: "Pulls SEBI circulars" },
    { name: "End", kind: "datastore", description: "Named like a keyword" },
  ],
  interactions: [
    { from: "User", to: "CircularFetcher", message: "start monitoring" },
    { from: "CircularFetcher", to: "end", message: "save; notify\n#1" },
    { from: "CircularFetcher", to: "End", message: "save gaps" },
  ],
};

const declared = (source: string) =>
  source
    .split("\n")
    .map((l) => /^\s*(?:actor|participant|component|database) (?:"(\w+)" as \w+|(\w+))/.exec(l))
    .filter((m) => m !== null)
    .map((m) => m[1] ?? m[2]);

describe("projectDiagram", () => {
  it("declares exactly the model's elements, once each, in every projected view", () => {
    for (const type of ["sequence", "component", "communication"] as const) {
      expect(declared(projectDiagram(type, MODEL).source)).toEqual(["User", "CircularFetcher", "End"]);
    }
  });

  it("aliases keyword names and flattens message text to one safe line", () => {
    const sequence = projectDiagram("sequence", MODEL).source;
    expect(sequence).toContain("participant _End as End");
    expect(sequence).toContain("CircularFetcher->>_End: save, notify ,1");

    const communication = projectDiagram("communication", MODEL).source;
    expect(communication).toContain('database "End" as _End');
    expect(communication).toContain("CircularFetcher --> _End : 2: save, notify ,1\\n3: save gaps");
  });
});
