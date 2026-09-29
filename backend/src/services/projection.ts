import type { ArchitectureModel } from "../schemas/architecture.schema.js";
import type { DiagramType, LlmDiagram } from "../schemas/diagram.schema.js";
import { FIRE_AND_FORGET_VERBS, firstVerb, isAnsweredExplicitly, isExplicitReply } from "./interaction-verbs.js";

/**
 * Views drawn by code from the architecture model rather than by the LLM, so every element
 * appears under the same name in each of them by construction.
 */
export const PROJECTED_TYPES: ReadonlySet<DiagramType> = new Set(["sequence", "communication", "component"]);

export const isProjected = (type: DiagramType) => PROJECTED_TYPES.has(type);

type Element = ArchitectureModel["elements"][number];

const MAX_LABEL = 80;

// Words that would be parsed as syntax if used as an id. Names are letters and digits only,
// so the "_" prefix can never collide with another element's name.
const MERMAID_KEYWORDS = new Set([
  "end", "loop", "alt", "else", "opt", "par", "and", "rect", "critical", "break", "option",
  "note", "participant", "actor", "activate", "deactivate", "autonumber", "box", "create",
  "destroy", "title", "over", "left", "right", "of", "as", "links", "link", "properties", "details",
]);
const PLANTUML_KEYWORDS = new Set([
  "end", "node", "database", "component", "actor", "interface", "package", "folder", "frame",
  "cloud", "rectangle", "queue", "note", "as", "left", "right", "up", "down", "title", "skinparam",
  "together", "hide", "show", "remove", "usecase", "artifact", "storage", "file", "card", "agent",
  "person", "boundary", "control", "entity", "collections", "participant", "legend", "top", "bottom",
]);

const idFor = (name: string, keywords: ReadonlySet<string>) =>
  keywords.has(name.toLowerCase()) ? `_${name}` : name;

/** One line of plain label text: no line breaks, statement separators or comment/entity markers. */
function label(text: string): string {
  const flat = text.replace(/[\r\n\t]+/g, " ").replace(/[;#]/g, ",").replace(/%%|'|"/g, "").replace(/\s+/g, " ").trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat || "…";
}

/** Layer names become box/package titles: keep them short and free of syntax characters. */
const layerName = (layer: string | null | undefined) =>
  (layer ?? "").replace(/[^A-Za-z0-9 &/-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

/**
 * Elements in drawing order: actors first (never grouped), then one group per layer in order of
 * first appearance, then elements without a layer.
 */
function grouped(model: ArchitectureModel): { layer: string | null; elements: Element[] }[] {
  const actors = model.elements.filter((e) => e.kind === "actor");
  const layers = new Map<string, Element[]>();
  const loose: Element[] = [];
  for (const e of model.elements) {
    if (e.kind === "actor") continue;
    const layer = layerName(e.layer);
    if (!layer) loose.push(e);
    else layers.set(layer, [...(layers.get(layer) ?? []), e]);
  }
  return [
    ...(actors.length ? [{ layer: null, elements: actors }] : []),
    ...[...layers].map(([layer, elements]) => ({ layer, elements })),
    ...(loose.length ? [{ layer: null, elements: loose }] : []),
  ];
}

/**
 * Interactions grouped per ordered (from, to) pair, in first-seen order, with their 1-based step numbers.
 * `dependenciesOnly` drops replies written out as steps: they point against the dependency.
 */
function pairs(model: ArchitectureModel, dependenciesOnly = false) {
  const byPair = new Map<string, { from: string; to: string; steps: { n: number; message: string }[] }>();
  model.interactions.forEach((it, i) => {
    if (dependenciesOnly && isExplicitReply(model.interactions, i)) return;
    const key = `${it.from.toLowerCase()}\u0000${it.to.toLowerCase()}`;
    const entry = byPair.get(key) ?? { from: it.from, to: it.to, steps: [] };
    entry.steps.push({ n: i + 1, message: it.message });
    byPair.set(key, entry);
  });
  return [...byPair.values()];
}

/** Interactions may differ in case from element names (the schema matches case-insensitively). */
function resolver(model: ArchitectureModel, keywords: ReadonlySet<string>) {
  const ids = new Map(model.elements.map((e) => [e.name.toLowerCase(), idFor(e.name, keywords)]));
  return (name: string) => ids.get(name.toLowerCase())!;
}

interface Unit {
  layer: string | null;
  elements: Element[];
}

const key = (name: string) => name.toLowerCase();

/**
 * Lifeline order for the sequence view, as contiguous units (one per layer; actors and unlayered
 * elements are units of their own):
 * 1. units follow the flow, by the first message each element sends or receives;
 * 2. the hub (most distinct partners, 3+) moves to the median of its partners, so its many arrows stay short;
 * 3. units, then elements within each layer, move wherever that strictly reduces the lifelines crossed;
 * 4. an external with a single partner sits right next to it.
 */
function sequenceUnits(model: ArchitectureModel): Unit[] {
  const firstSeen = new Map<string, number>();
  const partners = new Map<string, Set<string>>();
  model.interactions.forEach((it, i) => {
    const [a, b] = [key(it.from), key(it.to)];
    if (!firstSeen.has(a)) firstSeen.set(a, 2 * i);
    if (!firstSeen.has(b)) firstSeen.set(b, 2 * i + 1);
    if (a === b) return;
    partners.set(a, (partners.get(a) ?? new Set()).add(b));
    partners.set(b, (partners.get(b) ?? new Set()).add(a));
  });
  const seen = (e: Element) => firstSeen.get(key(e.name)) ?? Number.MAX_SAFE_INTEGER;

  const units: Unit[] = [];
  const byLayer = new Map<string, Unit>();
  for (const e of model.elements) {
    const layer = e.kind === "actor" ? "" : layerName(e.layer);
    if (!layer) {
      units.push({ layer: null, elements: [e] });
      continue;
    }
    const unit = byLayer.get(layer) ?? { layer, elements: [] };
    if (!byLayer.has(layer)) {
      byLayer.set(layer, unit);
      units.push(unit);
    }
    unit.elements.push(e);
  }
  for (const u of units) u.elements.sort((a, b) => seen(a) - seen(b));
  units.sort((a, b) => seen(a.elements[0]!) - seen(b.elements[0]!));

  const unitOf = (name: string) => units.find((u) => u.elements.some((e) => key(e.name) === name));
  const flat = () => units.flatMap((u) => u.elements.map((e) => key(e.name)));

  const hub = [...model.elements]
    .filter((e) => (partners.get(key(e.name))?.size ?? 0) >= 3)
    .sort((a, b) => partners.get(key(b.name))!.size - partners.get(key(a.name))!.size || seen(a) - seen(b))[0];
  const hubUnit = hub && unitOf(key(hub.name));
  if (hub && hubUnit && hubUnit.elements.length === 1) {
    units.splice(units.indexOf(hubUnit), 1);
    const order = flat();
    const positions = [...partners.get(key(hub.name))!]
      .map((p) => order.indexOf(p))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const mid = positions.length / 2;
    const median = positions.length % 2 ? positions[Math.floor(mid)]! : (positions[mid - 1]! + positions[mid]!) / 2;
    // Insert at the unit boundary closest to the median (a boundary b sits between positions b-1 and b).
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let boundary = 0;
    for (let u = 0; u <= units.length; u++) {
      const distance = Math.abs(boundary - (median + 0.5));
      if (distance < bestDistance) [best, bestDistance] = [u, distance];
      if (u < units.length) boundary += units[u]!.elements.length;
    }
    units.splice(best, 0, hubUnit);
  }

  // Externals with a single partner are pinned next to it afterwards, so they don't take part in the search.
  const pinned: { own: Unit; partner: string }[] = [];
  for (const external of model.elements.filter((e) => e.kind === "external")) {
    const only = partners.get(key(external.name));
    const own = unitOf(key(external.name));
    if (!only || only.size !== 1 || !own || own.elements.length !== 1) continue;
    const partner = [...only][0]!;
    if (key(external.name) === partner) continue;
    units.splice(units.indexOf(own), 1);
    pinned.push({ own, partner });
  }

  // Lifelines crossed by arrows, summed over the flow: the clutter this ordering minimises.
  const crossings = () => {
    const position = new Map(flat().map((name, i) => [name, i]));
    return model.interactions.reduce((sum, it) => {
      const a = position.get(key(it.from));
      const b = position.get(key(it.to));
      return a === undefined || b === undefined ? sum : sum + Math.max(0, Math.abs(a - b) - 1);
    }, 0);
  };
  /** Moves each item of `list` to the position with the fewest crossings; only strict gains count. */
  const improve = <T,>(list: T[]) => {
    let moved = false;
    for (const item of [...list]) {
      const from = list.indexOf(item);
      let best = { at: from, cost: crossings() };
      list.splice(from, 1);
      for (let at = 0; at <= list.length; at++) {
        list.splice(at, 0, item);
        const cost = crossings();
        if (cost < best.cost) best = { at, cost };
        list.splice(at, 1);
      }
      list.splice(best.at, 0, item);
      moved ||= best.at !== from;
    }
    return moved;
  };
  // Layers stay contiguous: whole units move first, then elements within their layer.
  for (let round = 0; round < 10; round++) {
    const movedUnits = improve(units);
    const movedMembers = units.map((u) => u.elements.length > 1 && improve(u.elements)).some(Boolean);
    if (!movedUnits && !movedMembers) break;
  }

  for (const { own, partner } of pinned) {
    const host = unitOf(partner)!;
    // The partner moves to the edge of its layer so the two lifelines are adjacent.
    const partnerElement = host.elements.find((e) => key(e.name) === partner)!;
    host.elements = [...host.elements.filter((e) => e !== partnerElement), partnerElement];
    units.splice(units.indexOf(host) + 1, 0, own);
  }
  return units;
}

export interface ProjectionOptions {
  /** First words of messages that never get a synthesised reply (defaults to FIRE_AND_FORGET_VERBS). */
  fireAndForgetVerbs?: ReadonlySet<string>;
}

function projectSequence(model: ArchitectureModel, options: ProjectionOptions): string {
  const id = resolver(model, MERMAID_KEYWORDS);
  const fireAndForget = options.fireAndForgetVerbs ?? FIRE_AND_FORGET_VERBS;
  const lines = ["sequenceDiagram", "    autonumber"];

  const declare = (e: Element, indent: string) => {
    const keyword = e.kind === "actor" ? "actor" : "participant";
    const ref = id(e.name);
    const shown = e.kind === "external" ? `${e.name} (external)` : e.name;
    lines.push(ref === shown ? `${indent}${keyword} ${ref}` : `${indent}${keyword} ${ref} as ${shown}`);
  };
  for (const unit of sequenceUnits(model)) {
    if (!unit.layer) {
      for (const e of unit.elements) declare(e, "    ");
      continue;
    }
    lines.push(`    box transparent ${unit.layer}`);
    for (const e of unit.elements) declare(e, "        ");
    lines.push("    end");
  }

  const steps = model.interactions;
  steps.forEach((it, i) => {
    // A reply the model wrote out as a step is drawn as one; it never gets a reply of its own.
    const reply = isExplicitReply(steps, i);
    lines.push(`    ${id(it.from)}${reply ? "-->>" : "->>"}${id(it.to)}: ${label(it.message)}`);
    const synthesise =
      !!it.returns?.trim() && !reply && !isAnsweredExplicitly(steps, i) && !fireAndForget.has(firstVerb(it.message));
    if (synthesise) lines.push(`    ${id(it.to)}-->>${id(it.from)}: ${label(it.returns!)}`);
  });
  return lines.join("\n");
}

function plantNode(e: Element, ref: string): string {
  const keyword = e.kind === "actor" ? "actor" : e.kind === "datastore" ? "database" : "component";
  const declared = ref === e.name ? `${keyword} ${e.name}` : `${keyword} "${e.name}" as ${ref}`;
  return e.kind === "external" ? `${declared} <<external>>` : declared;
}

function projectPlantUml(model: ArchitectureModel, numbered: boolean): string {
  const id = resolver(model, PLANTUML_KEYWORDS);
  const lines = ["@startuml", "left to right direction", "skinparam componentStyle rectangle"];
  for (const group of grouped(model)) {
    if (!group.layer) {
      for (const e of group.elements) lines.push(plantNode(e, id(e.name)));
      continue;
    }
    lines.push(`package "${group.layer}" {`);
    for (const e of group.elements) lines.push(`  ${plantNode(e, id(e.name))}`);
    lines.push("}");
  }
  for (const p of pairs(model, !numbered)) {
    // Communication shows every numbered message; the component view names at most two per dependency.
    const messages = p.steps.map((s) => (numbered ? `${s.n}: ${label(s.message)}` : label(s.message)));
    const shown = numbered || messages.length <= 2 ? messages : [...messages.slice(0, 2), `+${messages.length - 2} more`];
    lines.push(`${id(p.from)} --> ${id(p.to)} : ${shown.join("\\n")}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}

const TITLES: Record<string, string> = {
  sequence: "Main flow",
  component: "Components",
  communication: "Communication",
};

export function projectDiagram(
  type: DiagramType,
  model: ArchitectureModel,
  options: ProjectionOptions = {},
): LlmDiagram {
  if (!PROJECTED_TYPES.has(type)) throw new Error(`${type} is not a projected diagram type`);
  const source =
    type === "sequence" ? projectSequence(model, options) : projectPlantUml(model, type === "communication");
  return { type, title: TITLES[type]!, source };
}
