import type { ArchitectureModel } from "../schemas/architecture.schema.js";

type Interaction = ArchitectureModel["interactions"][number];

/** Messages that hand something over and expect nothing back: no reply is drawn for them. */
export const FIRE_AND_FORGET_VERBS: ReadonlySet<string> = new Set([
  "store", "save", "write", "persist", "record", "log", "insert", "upsert", "update", "append",
  "notify", "alert", "email", "deliver", "send", "publish", "emit", "push", "pass", "forward",
  "hand", "submit", "enqueue", "dispatch", "broadcast",
]);

/**
 * Requests that are always reads. Ambiguous verbs ("load", "fetch", "pull") are reads only when
 * data comes back (`returns`); "ComplianceTeam -> Store: load controls" is a write.
 */
export const READ_VERBS: ReadonlySet<string> = new Set([
  "read", "get", "query", "retrieve", "lookup", "look", "select", "find", "search", "list", "scan",
]);

/** Requests that put data into a datastore. */
export const WRITE_VERBS: ReadonlySet<string> = new Set([
  "store", "save", "write", "persist", "record", "log", "insert", "upsert", "update", "append",
  "import", "upload", "register", "maintain", "add", "put", "create", "delete", "archive", "sync",
]);

/** Messages that are themselves the answer to a previous request. */
const REPLY_VERBS: ReadonlySet<string> = new Set(["return", "returns", "respond", "responds", "reply", "replies", "answer"]);

/** First word of a message, lowercased ("Store clause table" -> "store"). */
export const firstVerb = (message: string) => /[a-z]+/i.exec(message)?.[0]?.toLowerCase() ?? "";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `later` goes back along `earlier` (to -> from). */
const reverses = (earlier: Interaction | undefined, later: Interaction | undefined) =>
  !!earlier && !!later && same(earlier.from, later.to) && same(earlier.to, later.from);

/**
 * The interaction at `i` is a reply the model wrote out as its own step: a "Return …" style message,
 * or the immediate reverse of the previous step.
 */
export function isExplicitReply(interactions: readonly Interaction[], i: number): boolean {
  const it = interactions[i]!;
  return REPLY_VERBS.has(firstVerb(it.message)) || reverses(interactions[i - 1], it);
}

/** The next step already answers the one at `i` (so no reply should be synthesised for it). */
export const isAnsweredExplicitly = (interactions: readonly Interaction[], i: number) =>
  reverses(interactions[i], interactions[i + 1]);
