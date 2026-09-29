import type { ArchitectureModel } from "../schemas/architecture.schema.js";
import type { DiagramType } from "../schemas/diagram.schema.js";
import { firstVerb, isExplicitReply, READ_VERBS, WRITE_VERBS } from "./interaction-verbs.js";

interface DiagramLike {
  type: DiagramType;
  source: string;
}

/**
 * Issues (fed back to the model) when an update returns the previous version's LLM-drawn diagrams
 * unchanged. Name consistency needs no check: the views that must list exactly the architecture's
 * elements are projected from the model by code (see projection.ts).
 */
export function checkConsistency(diagrams: DiagramLike[], previous?: DiagramLike[]): string[] {
  if (!previous?.length) return [];
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const before = new Map(previous.map((d) => [d.type, flat(d.source)]));
  // Only when nothing new was requested: adding a diagram type legitimately leaves others as they were.
  const allExisted = diagrams.length > 0 && diagrams.every((d) => before.has(d.type));
  if (allExisted && diagrams.every((d) => before.get(d.type) === flat(d.source))) {
    return [
      "The diagrams are identical to the previous version. Apply the requested change and redraw them from the architecture model.",
    ];
  }
  return [];
}

/**
 * Gaps in the architecture's main flow, fed back to the model: every step must be triggered.
 * An interaction may start from an actor (people, schedulers) or an external system (event sources),
 * or from an element an earlier interaction reached. Datastores only answer requests.
 */
export function flowIssues(model: ArchitectureModel): string[] {
  const issues: string[] = [];
  const kindOf = new Map(model.elements.map((e) => [e.name.toLowerCase(), e.kind]));
  const reached = new Set<string>();

  model.interactions.forEach((it, i) => {
    const from = it.from.toLowerCase();
    const step = `Interaction ${i + 1} (${it.from} -> ${it.to}: "${it.message}")`;
    const kind = kindOf.get(from);
    if (kind === "datastore") {
      issues.push(
        `${step} starts from datastore ${it.from}. Datastores only answer: make it a request to ${it.from} and put the data it gives back in \`returns\`.`,
      );
    } else if (kind !== "actor" && kind !== "external" && !reached.has(from)) {
      issues.push(
        `${step} starts from ${it.from}, which no earlier interaction triggers. Add the message that starts ${it.from} before it (e.g. from an orchestrator or the previous step), or model a scheduler as an actor.`,
      );
    }
    reached.add(it.to.toLowerCase());
  });
  return issues;
}

/** Replies written out as their own interaction duplicate `returns` and clutter every view. */
export function replyIssues(model: ArchitectureModel): string[] {
  return model.interactions.flatMap((it, i) =>
    isExplicitReply(model.interactions, i)
      ? [
          `Interaction ${i + 1} (${it.from} -> ${it.to}: "${it.message}") is a reply to the previous step. Remove it and put what comes back in the previous interaction's \`returns\`.`,
        ]
      : [],
  );
}

/**
 * R1: a datastore that is never written (or never read) is a modelling gap, e.g. an "existing setup"
 * database with no way to load the setup. `intentional_reason` only excuses a store that is written
 * but never read (an audit archive): anything that is read must show where its data comes from.
 */
export function datastoreIssues(model: ArchitectureModel): string[] {
  const issues: string[] = [];
  for (const store of model.elements.filter((e) => e.kind === "datastore")) {
    const requests = model.interactions.filter((it) => it.to.toLowerCase() === store.name.toLowerCase());
    const reads = requests.filter((it) => {
      const verb = firstVerb(it.message);
      return READ_VERBS.has(verb) || (!!it.returns?.trim() && !WRITE_VERBS.has(verb));
    });
    const writes = requests.filter((it) => {
      const verb = firstVerb(it.message);
      return WRITE_VERBS.has(verb) || (!READ_VERBS.has(verb) && !it.returns?.trim());
    });
    if (!writes.length) {
      issues.push(
        `Datastore ${store.name}: nothing writes to it. Add the interaction that loads it (e.g. the team or ` +
          "import job that maintains it). `intentional_reason` can't excuse this: data that is read must come from somewhere.",
      );
    }
    if (!reads.length && !store.intentional_reason?.trim()) {
      issues.push(
        `Datastore ${store.name}: nothing reads from it. Add the interaction that uses it, or set its \`intentional_reason\` ` +
          "if it is write-only on purpose (e.g. an audit archive).",
      );
    }
  }
  return issues;
}

const TRIGGER_VERBS: ReadonlySet<string> = new Set([
  "trigger", "start", "run", "kick", "launch", "invoke", "begin", "initiate", "execute", "schedule",
]);
// What a started step reports back: its outcome, not the data it produced (that goes to a datastore).
const OUTCOME = /\b(ready|done|complete\w*|finished|status|success\w*|ok|succeeded|failed|stored|available|acknowledg\w*|count|summary|result status)\b/i;
const FETCHER_NAME = /fetch|crawl|scrap|poll|download|ingest/i;
const FETCHES = /\b(fetch\w*|pull\w*|download\w*|scrap\w*|crawl\w*|poll\w*)\b.*\bfrom\b/i;

/**
 * Orchestration: a started step answers with its outcome (so the caller knows it finished) and a
 * non-human trigger starts one element, which sequences the rest; otherwise steps race each other.
 */
export function orchestrationIssues(model: ArchitectureModel): string[] {
  const issues: string[] = [];
  const kindOf = new Map(model.elements.map((e) => [e.name.toLowerCase(), e]));
  const startedBy = new Map<string, Set<string>>();
  const silent: string[] = []; // one combined issue keeps the retry prompt small

  model.interactions.forEach((it, i) => {
    if (!TRIGGER_VERBS.has(firstVerb(it.message))) return;
    const from = kindOf.get(it.from.toLowerCase());
    const to = kindOf.get(it.to.toLowerCase());
    if (to?.kind !== "service") return;
    const step = `Interaction ${i + 1} (${it.from} -> ${it.to}: "${it.message}")`;
    const returns = it.returns?.trim();
    if (returns && !OUTCOME.test(returns)) {
      issues.push(
        `${step} returns data ("${returns}") to the element that started it. A started step returns its outcome ` +
          `(e.g. "${it.to} complete"); the data it produces goes to a datastore.`,
      );
    } else if (!returns && from?.kind === "service") {
      silent.push(`${i + 1} (${it.from} -> ${it.to})`);
    }
    if (from?.kind === "actor") {
      startedBy.set(from.name, (startedBy.get(from.name) ?? new Set()).add(to.name));
    }
  });

  if (silent.length) {
    issues.push(
      `Interactions ${silent.join(", ")} start a step but never hear back. Set each one's \`returns\` to the step's outcome (e.g. "parsing complete").`,
    );
  }

  for (const [actor, started] of startedBy) {
    const e = kindOf.get(actor.toLowerCase())!;
    const automatic = NON_HUMAN_NAME.test(e.name) || NON_HUMAN_DESCRIPTION.test(e.description);
    if (automatic && started.size > 1) {
      issues.push(
        `${actor} starts ${[...started].join(" and ")} independently, so later steps can run before earlier ones finish. ` +
          "Let it start one element (e.g. an orchestrator) that calls the rest in order.",
      );
    }
  }
  return issues;
}

/** A service that fetches from outside the system needs that source modelled as an external element. */
export function sourceIssues(model: ArchitectureModel): string[] {
  const externals = new Set(model.elements.filter((e) => e.kind === "external").map((e) => e.name.toLowerCase()));
  return model.elements
    .filter((e) => e.kind === "service" && (FETCHER_NAME.test(e.name) || FETCHES.test(e.description)))
    .filter(
      (e) =>
        !model.interactions.some(
          (it) =>
            (it.from.toLowerCase() === e.name.toLowerCase() && externals.has(it.to.toLowerCase())) ||
            (it.to.toLowerCase() === e.name.toLowerCase() && externals.has(it.from.toLowerCase())),
        ),
    )
    .map(
      (e) =>
        `${e.name} fetches data from outside the system ("${e.description}"), but no external element is modelled. ` +
        "Add the source as an external element (e.g. SEBIWebsite) and the interaction that fetches from it.",
    );
}

const WANTS_NEW_ONLY = /\b(latest|newly|recent\w*|new (circulars|items|documents|filings|notices|updates|releases))\b/i;
const SKIPS_PROCESSED =
  /(already|previously) (processed|seen|fetched|ingested)|unprocessed|not yet processed|dedup\w*|duplicate|since (the )?last|last run|processed (ids|list|log|circulars|items)|only new|new ones|skip\w* (known|processed|seen)|check\w* .*(processed|seen|new)|compare .*(previous|stored|known)/i;

/** "Latest"/"new" in the requirements needs a step that tells new items from ones already processed. */
export function freshnessIssues(model: ArchitectureModel, requirements: string): string[] {
  const phrase = WANTS_NEW_ONLY.exec(requirements)?.[0];
  if (!phrase) return [];
  const handled = model.interactions.some((it) => SKIPS_PROCESSED.test(`${it.message} ${it.returns ?? ""}`));
  return handled
    ? []
    : [
        `The requirements ask for the "${phrase}" items, but no step tells new items from ones already processed. ` +
          'Add it (e.g. the fetcher checks the repository for already processed circulars and returns "unprocessed circulars").',
      ];
}

const MONITORING = /\b(monitor\w*|watch\w*|schedul\w*|periodic\w*|daily|hourly|weekly|nightly|poll\w*|cron|continuous\w*|real[- ]?time|recurring|automatic\w*)\b/i;
// Names can be matched broadly (DailyScheduler, CircularFeedWebhook, PollJob); descriptions only by
// mechanical terms, since a person's description often says "monitors" or "triggers".
const NON_HUMAN_NAME = /schedul|timer|cron|clock|webhook|feed|poll|job|trigger|rss|watcher/i;
const NON_HUMAN_DESCRIPTION = /\b(scheduler|scheduled|timer|cron|clock|webhook|rss|poller|polling)\b/i;

/**
 * R5: requirements that describe ongoing monitoring need something other than a person to start the
 * flow: a scheduler actor, or an external system that pushes events (starts an interaction itself).
 */
export function triggerIssues(model: ArchitectureModel, requirements: string): string[] {
  const phrase = MONITORING.exec(requirements)?.[0];
  if (!phrase) return [];
  // A reply written out as a step ("Return circular PDFs") doesn't start anything.
  const starters = new Set(
    model.interactions.filter((_, i) => !isExplicitReply(model.interactions, i)).map((it) => it.from.toLowerCase()),
  );
  const automatic = model.elements.some(
    (e) =>
      starters.has(e.name.toLowerCase()) &&
      (e.kind === "external" ||
        (e.kind === "actor" && (NON_HUMAN_NAME.test(e.name) || NON_HUMAN_DESCRIPTION.test(e.description)))),
  );
  return automatic
    ? []
    : [
        `The requirements describe ongoing monitoring ("${phrase}"), but only people start the flow. ` +
          "Add a non-human trigger (a scheduler actor such as DailyScheduler, or an external webhook/feed) that starts it, in addition to any manual request.",
      ];
}

/** Every soft check on a new or revised architecture model, fed back to the model before projection. */
export function architectureIssues(model: ArchitectureModel, requirements: string): string[] {
  return [
    ...flowIssues(model),
    ...replyIssues(model),
    ...datastoreIssues(model),
    ...triggerIssues(model, requirements),
    ...orchestrationIssues(model),
    ...sourceIssues(model),
    ...freshnessIssues(model, requirements),
  ];
}
