import type { ArchitectureModel } from "../schemas/architecture.schema.js";
import { ENGINE_BY_TYPE, type DiagramType } from "../schemas/diagram.schema.js";

/**
 * Diagram types whose participants/components must be exactly the architecture's elements.
 * Deployment is excluded: its nodes (servers, containers) are legitimately extra elements.
 */
export const CHECKED_TYPES: ReadonlySet<DiagramType> = new Set(["sequence", "communication", "component"]);

/** A name found in a diagram: its identifier and, when aliased, its display label. */
export interface FoundName {
  id: string;
  label?: string;
}

interface DiagramLike {
  type: DiagramType;
  source: string;
}

export const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const unwrap = (token: string) => token.trim().replace(/^\[|\]$/g, "").replace(/^"|"$/g, "").trim();

// --- Mermaid sequenceDiagram ---
const MERMAID_DECL = /^\s*(?:participant|actor)\s+(\S+?)(?:\s+as\s+(.+?))?\s*$/;
// A->>B: msg, A-->>B, A-xB, A-)B, with optional +/- activation markers.
const MERMAID_MSG = /^\s*([^\s:]+?)\s*--?(?:>>|>|x|\))\s*[+-]?\s*([^\s:]+?)\s*:/;

// --- PlantUML ---
// PlantUML keywords are lowercase, so these are case-sensitive: an element named `Node` is not skipped.
const PLANTUML_SKIP =
  /^\s*(?:@|'|end\b|title\b|skinparam\b|package\b|node\b|folder\b|frame\b|cloud\b|rectangle\b|together\b|left\b|right\b|top\b|hide\b|show\b|autonumber\b|activate\b|deactivate\b|alt\b|else\b|opt\b|loop\b|group\b|par\b|break\b|critical\b|ref\b|==|\.\.\.|\||}|{)/;
// Element declarations: `database "Label" as Id`, `component [Label] as Id`, `participant Id as "Label"`, `actor Id`.
const PLANTUML_DECL =
  /^\s*(?:actor|participant|boundary|control|entity|database|collections|queue|component|agent|person|storage)\s+(?:"([^"]+)"|\[([^\]]+)\]|([^\s{"<[]+))(?:\s+as\s+(?:"([^"]+)"|([^\s"{<]+)))?/;
// Interfaces are ports, not elements: `interface X`, `() "Label" as X`, `() X`.
const PLANTUML_INTERFACE = /^\s*(?:interface\s+|\(\)\s*)(?:"([^"]+)"|([^\s"{<]+))(?:\s+as\s+([^\s"{<]+))?/;
// `[Label] as Id` used without a keyword.
const PLANTUML_BRACKET_ALIAS = /^\s*\[([^\]]+)\]\s+as\s+([^\s"{<]+)/;
const PLANTUML_BRACKET = /\[([^\]]+)\]/g;
const PLANTUML_ARROW =
  /^\s*("[^"]+"|\[[^\]]+\]|[A-Za-z_][\w.]*)\s*[<o*#x}+^]*[-.]+[-.]*[>o*#x{+^]*\s*("[^"]+"|\[[^\]]+\]|[A-Za-z_][\w.]*)/;
// Arrow style/colour hints such as -[hidden]-> or -[#red,dashed]->: a bracket inside the arrow,
// followed by more arrow. `[A]--[B]` (a plain link to a component) is left alone.
const ARROW_STYLE = /([-.])\[[^\]]*\](?=[-.>])/g;

function extractMermaid(source: string): FoundName[] {
  const found: FoundName[] = [];
  for (const line of source.split("\n")) {
    const decl = MERMAID_DECL.exec(line);
    if (decl) {
      found.push(decl[2] ? { id: decl[1]!, label: unwrap(decl[2]) } : { id: decl[1]! });
      continue;
    }
    const msg = MERMAID_MSG.exec(line);
    if (msg) found.push({ id: msg[1]! }, { id: msg[2]! });
  }
  return found;
}

function extractPlantUml(source: string): { found: FoundName[]; interfaces: Set<string> } {
  const found: FoundName[] = [];
  const interfaces = new Set<string>();
  let block: "note" | "legend" | null = null;

  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    // Multi-line note/legend bodies are free text.
    if (block === "note") {
      if (/^\s*end\s*note\b/.test(line)) block = null;
      continue;
    }
    if (block === "legend") {
      if (/^\s*endlegend\b/.test(line)) block = null;
      continue;
    }
    if (/^\s*[rh]?note\b/.test(line)) {
      if (!line.includes(":")) block = "note"; // one-line notes use `note ... : text`
      continue;
    }
    if (/^\s*legend\b/.test(line)) {
      block = "legend";
      continue;
    }
    if (PLANTUML_SKIP.test(line)) continue;

    const iface = PLANTUML_INTERFACE.exec(line);
    if (iface) {
      for (const n of [iface[1], iface[2], iface[3]]) if (n) interfaces.add(normalizeName(n));
      continue;
    }
    const decl = PLANTUML_DECL.exec(line);
    if (decl) {
      const declared = decl[1] ?? decl[2] ?? decl[3]!;
      const alias = decl[4] ?? decl[5];
      if (!alias) found.push({ id: declared });
      else if (decl[4]) found.push({ id: declared, label: alias }); // `participant Id as "Label"`
      else found.push({ id: alias, label: declared }); // `database "Label" as Id`
      continue;
    }
    const bracketAlias = PLANTUML_BRACKET_ALIAS.exec(line);
    if (bracketAlias) {
      found.push({ id: bracketAlias[2]!, label: bracketAlias[1]! });
      continue;
    }

    // Relationships: ignore arrow styles and the label after ` : ` (data belongs there).
    const relation = line.replace(ARROW_STYLE, "$1").split(/\s:\s|\s:$|:\s/)[0]!;
    for (const m of relation.matchAll(PLANTUML_BRACKET)) found.push({ id: m[1]! });
    const arrow = PLANTUML_ARROW.exec(relation);
    if (arrow) {
      for (const end of [arrow[1]!, arrow[2]!]) if (!end.startsWith("[")) found.push({ id: end });
    }
  }
  return { found, interfaces };
}

export function extractNames(type: DiagramType, source: string): FoundName[] {
  let found: FoundName[];
  let interfaces = new Set<string>();
  if (ENGINE_BY_TYPE[type] === "mermaid") {
    found = extractMermaid(source);
  } else {
    ({ found, interfaces } = extractPlantUml(source));
  }
  const cleaned = found
    .map((n) => ({ id: unwrap(n.id), label: n.label ? unwrap(n.label) : undefined }))
    .filter((n) => n.id && !n.id.startsWith("#") && n.id !== "*" && !interfaces.has(normalizeName(n.id)));
  // Aliases declared once (`participant F as CircularFetcher`) are used bare elsewhere (`F->>B`).
  const labels = new Map(cleaned.filter((n) => n.label).map((n) => [n.id, n.label!]));
  return cleaned.map((n) => {
    const label = n.label ?? labels.get(n.id);
    return label ? { id: n.id, label } : { id: n.id };
  });
}

/** Issues found in diagrams already checked and accepted; the model can't fix these on retry. */
export function nameIssues(diagrams: DiagramLike[], model: ArchitectureModel): string[] {
  const issues: string[] = [];
  const modelNames = new Map(model.elements.map((e) => [normalizeName(e.name), e.name]));

  for (const diagram of diagrams) {
    if (!CHECKED_TYPES.has(diagram.type)) continue;
    const names = extractNames(diagram.type, diagram.source);
    if (names.length === 0) {
      issues.push(
        `${diagram.type} diagram: no participants/components recognised. Declare each element explicitly ` +
          "(`actor Name`, `participant Name`, `component Name`, `database Name`).",
      );
      continue;
    }
    const matched = new Set<string>();
    const extra = new Set<string>();
    for (const n of names) {
      const hit = [n.id, n.label].map((x) => (x ? normalizeName(x) : "")).find((k) => modelNames.has(k));
      if (hit) matched.add(hit);
      else extra.add(n.label ?? n.id);
    }
    const missing = [...modelNames.keys()].filter((k) => !matched.has(k)).map((k) => modelNames.get(k)!);
    if (extra.size) {
      issues.push(
        `${diagram.type} diagram uses names that are not architecture elements: ${[...extra].join(", ")}. ` +
          "Use only element names; show data as message/arrow labels.",
      );
    }
    if (missing.length) {
      issues.push(`${diagram.type} diagram is missing architecture elements: ${missing.join(", ")}.`);
    }
  }
  return issues;
}

/**
 * Human-readable issues (fed back to the model) when the diagrams don't match the architecture
 * model, or when an update returns the previous version's diagrams unchanged.
 */
export function checkConsistency(
  diagrams: DiagramLike[],
  model: ArchitectureModel,
  previous?: DiagramLike[],
): string[] {
  const issues = nameIssues(diagrams, model);

  if (previous?.length) {
    const flat = (s: string) => s.replace(/\s+/g, " ").trim();
    const before = new Map(previous.map((d) => [d.type, flat(d.source)]));
    // Only when nothing new was requested: adding a diagram type legitimately leaves others as they were.
    const allExisted = diagrams.length > 0 && diagrams.every((d) => before.has(d.type));
    if (allExisted && diagrams.every((d) => before.get(d.type) === flat(d.source))) {
      issues.push(
        "The diagrams are identical to the previous version. Apply the requested change and redraw them from the architecture model.",
      );
    }
  }
  return issues;
}
