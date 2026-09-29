/** A step of a generation, streamed to the client so a long request doesn't look stuck. */
export interface ProgressEvent {
  stage: "context" | "architecture" | "checks" | "diagrams" | "render" | "save";
  message: string;
  /** Optional specifics, e.g. the gaps the checks found. */
  details?: string[];
}

/** A batch of the model's own words while a call runs: its reasoning, or the answer being written. */
export interface ThinkingChunk {
  stage: ProgressEvent["stage"];
  /** The model call these words belong to, e.g. "Revising the architecture model (attempt 2)". */
  call: string;
  channel: "reasoning" | "answer";
  text: string;
}

/**
 * Receives steps; when `thinking` is set, model calls stream their tokens to it too.
 * Callers that don't care about either pass `noProgress`.
 */
export interface ProgressReporter {
  (event: ProgressEvent): void;
  thinking?: (chunk: ThinkingChunk) => void;
}

export const noProgress: ProgressReporter = () => {};
