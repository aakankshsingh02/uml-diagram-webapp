import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmDiagramsResponseSchema, unescapeDoubleEscapedSource } from "../../src/schemas/diagram.schema.js";
import { KrokiService } from "../../src/services/kroki.service.js";

// The exact shape Groq returned for the SEBI prompt: one line, literal \n and \" sequences.
const DOUBLE_ESCAPED = String.raw`@startuml\npackage \"Data Ingestion\" {\n  [CircularFetcher] --> [RawCirculars]\n}\n@enduml`;

describe("unescapeDoubleEscapedSource", () => {
  it("restores line breaks and quotes in a double-escaped source", () => {
    expect(unescapeDoubleEscapedSource(DOUBLE_ESCAPED)).toBe(
      '@startuml\npackage "Data Ingestion" {\n  [CircularFetcher] --> [RawCirculars]\n}\n@enduml',
    );
  });

  it("leaves a normal multi-line source untouched, including PlantUML's in-label \\n", () => {
    const normal = "@startuml\nAlice -> Bob: line one\\nline two\n@enduml";
    expect(unescapeDoubleEscapedSource(normal)).toBe(normal);
  });

  it("leaves single-line sources without escapes untouched", () => {
    expect(unescapeDoubleEscapedSource("graph TD; A-->B")).toBe("graph TD; A-->B");
  });

  it("is applied when the model response is validated", () => {
    const parsed = LlmDiagramsResponseSchema.parse({
      diagrams: [{ type: "component", title: "Compliance", source: DOUBLE_ESCAPED }],
    });
    expect(parsed.diagrams[0]!.source.split("\n")).toHaveLength(5);
  });
});

describe("KrokiService PlantUML welcome page", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubSvg = (svg: string) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(svg, { status: 200 })));

  it("treats PlantUML's welcome page as a non-retryable render error so repair runs", async () => {
    stubSvg("<svg><text>Welcome to PlantUML!</text></svg>");
    const result = await new KrokiService("http://kroki.test").renderSvg("plantuml", "@startuml\n@enduml");
    expect(result).toMatchObject({ ok: false, retryable: false });
  });

  it("accepts a normal PlantUML render and doesn't apply the check to Mermaid", async () => {
    stubSvg("<svg><text>CircularFetcher</text></svg>");
    expect(await new KrokiService("http://kroki.test").renderSvg("plantuml", "@startuml\n[A]\n@enduml")).toMatchObject({
      ok: true,
    });
    stubSvg("<svg><text>Welcome to PlantUML!</text></svg>");
    expect(await new KrokiService("http://kroki.test").renderSvg("mermaid", "graph TD; A-->B")).toMatchObject({ ok: true });
  });
});
