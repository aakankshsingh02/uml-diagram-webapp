import Groq, { APIError } from "groq-sdk";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "groq-sdk/resources/chat/completions";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import { LlmArchitectureResponseSchema, type ArchitectureModel } from "../schemas/architecture.schema.js";
import {
  ENGINE_BY_TYPE,
  LlmDiagramsResponseSchema,
  LlmRepairResponseSchema,
  type DiagramType,
  type Engine,
  type LlmDiagram,
} from "../schemas/diagram.schema.js";
import { architectureIssues, checkConsistency } from "./consistency.js";
import { noProgress, type ProgressEvent, type ProgressReporter } from "./progress.js";

const MAX_ATTEMPTS = 2;
/** Architecture and diagram calls get one extra attempt for soft (flow/consistency) feedback. */
const DIAGRAM_ATTEMPTS = 3;

const SYNTAX_HINTS: Record<Engine, string> = {
  mermaid:
    "Mermaid: class -> `classDiagram`, sequence -> `sequenceDiagram`, state_machine -> `stateDiagram-v2`, activity -> `flowchart TD`. No ``` fences.",
  plantuml: "PlantUML: wrap every diagram in `@startuml` / `@enduml`. No ``` fences.",
  excalidraw: "Excalidraw JSON scene.",
};

// Sequence, communication and component views are projected from the model by code (projection.ts).
const VIEW_RULES = "Use only element names from the model for anything that represents a system part.";

export interface PreviousGeneration {
  prompt: string;
  /** The conversation's first prompt; later prompts are change requests on top of it. */
  requirements?: string;
  /** The version's architecture model; null for versions created before models existed. */
  architecture: ArchitectureModel | null;
  diagrams: Pick<LlmDiagram, "type" | "title" | "source">[];
  /** The owner's ratings/comments on the previous version's diagrams. */
  feedback?: DiagramFeedback[];
}

export interface DiagramFeedback {
  type: DiagramType;
  rating: 1 | -1;
  comment: string | null;
}

/** The user's verdicts on the previous version, as a prompt section (none when there are none). */
function feedbackSection(previous?: PreviousGeneration): string[] {
  if (!previous?.feedback?.length) return [];
  const lines = previous.feedback.map(
    (f) => `- ${f.type} diagram: ${f.rating === 1 ? "rated right" : "rated WRONG"}${f.comment ? ` — "${f.comment}"` : ""}`,
  );
  return [
    `User feedback on the previous version (fix what was rated wrong, keep what was rated right):\n${lines.join("\n")}`,
  ];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The successful exchange behind a generation, kept as RL training data. */
export interface GenerationTrace {
  model: string;
  /** system, user, and the assistant reply that was accepted (failed attempts excluded). */
  messages: ChatMessage[];
  attempts: number;
  latencyMs: number;
  /** Consistency issues still present in the accepted reply (empty when fully consistent). */
  issues: string[];
}

export interface GeneratedDiagrams {
  diagrams: LlmDiagram[];
  trace: GenerationTrace;
}

export interface DesignedArchitecture {
  architecture: ArchitectureModel;
  trace: GenerationTrace;
}

interface JsonCompletion<T> {
  data: T;
  content: string;
  attempts: number;
  latencyMs: number;
  issues: string[];
}

/** What DiagramService needs from the model; lets tests substitute a fake. */
export type DiagramLlm = Pick<LlmService, "designArchitecture" | "generateDiagrams" | "repairDiagram">;

type ReasoningEffort = "low" | "medium" | "high";

export interface LlmTuning {
  /** Reasoning depth for models that support it (gpt-oss, qwen3); lower is much faster. */
  reasoningEffort?: ReasoningEffort;
  /** Overrides `reasoningEffort` for the architecture call, which every diagram depends on. */
  architectureReasoningEffort?: ReasoningEffort;
  /** Soft-issue retries stop once a call has run this long; the best reply so far is accepted. */
  softRetryBudgetMs?: number;
}

const REASONING_MODELS = /gpt-oss|qwen3/i;

/** 413 "request too large" and 429 are both the provider's token/rate limits. */
const isRateLimited = (err: unknown) => err instanceof APIError && (err.status === 413 || err.status === 429);

/** Groq JSON mode's "json_validate_failed": the model produced something that isn't JSON. */
const isInvalidJson = (err: unknown) =>
  err instanceof APIError &&
  err.status === 400 &&
  (err.error as { error?: { code?: string } } | undefined)?.error?.code === "json_validate_failed";

/** Provider failures become HTTP errors the client can show, instead of an opaque 500. */
function toHttpError(err: unknown): unknown {
  if (!(err instanceof APIError)) return err;
  if (isRateLimited(err)) {
    const retryAfter = Number(err.headers?.get("retry-after")) || 60;
    return new HttpError(429, `The model's rate limit was reached. Try again in about ${retryAfter} seconds.`, {
      retry_after_seconds: retryAfter,
    });
  }
  if (err.status === 401 || err.status === 403) return HttpError.unavailable("The LLM API key was rejected");
  return HttpError.badGateway("The LLM request failed", err.message);
}
const DEFAULT_SOFT_RETRY_BUDGET_MS = 15_000;

export class LlmService {
  private readonly client: Groq | null;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: Groq,
    private readonly tuning: LlmTuning = {},
  ) {
    this.client = client ?? (apiKey ? new Groq({ apiKey }) : null);
  }

  /**
   * Step 1: the system's elements and interactions, the shared source every diagram is drawn
   * from. On an update the previous model is revised rather than recreated.
   */
  async designArchitecture(
    prompt: string,
    previous?: PreviousGeneration,
    onProgress: ProgressReporter = noProgress,
  ): Promise<DesignedArchitecture> {
    const system = [
      "You are a senior software architect. Model the system described by the user as elements and interactions.",
      'Respond with ONLY a JSON object: {"architecture":{"elements":[{"name":string,"kind":"actor"|"service"|"datastore"|"external","description":string,"layer":string|null,"intentional_reason":string|null}],"interactions":[{"from":string,"to":string,"message":string,"returns":string|null}]}}.',
      "Element names are PascalCase identifiers (letters and digits only), e.g. CircularFetcher.",
      "Elements are active parts: people and schedulers (actor), services/modules (service), databases (datastore), third-party systems (external).",
      "Data such as documents, tables, reports and files are NOT elements; mention them inside interaction messages.",
      "Datastores are systems of record, not individual data sets: use one datastore per system (e.g. ComplianceRepository holding clauses, requirements, gaps and reports), not one per table or report.",
      "External sources are elements too: anything the system fetches from or sends to outside (e.g. SEBIWebsite) is an `external` element with its own interaction.",
      "Coverage: every requirement in the user's text (each numbered item, each input and each output) must be handled by at least one interaction. Name outputs after everything they contain (a report with requirements, gaps and impact is a compliance report, not an impact report).",
      "Inputs: each analysis step reads every input its result depends on (e.g. an IT/operational impact assessment needs the organisation's systems and processes, not only the gaps).",
      "Every element must take part in at least one interaction. List interactions in the order they happen in the main flow.",
      "The flow must be causal: an interaction starts from an actor, an external system, or an element that an earlier interaction reached. Add the messages that trigger each step (e.g. an orchestrator or the previous step calling the next).",
      "Monitoring: when the requirements describe monitoring, the latest/new items or anything recurring, add a non-human trigger (a scheduler actor such as DailyScheduler, or an external webhook/feed). It starts ONE element (e.g. an orchestrator) that runs the steps in order, and one step skips items already processed (e.g. the fetcher checks the repository and returns \"unprocessed circulars\"). A manual path may exist as well.",
      'Replies: never write a reply as its own interaction ("Return X"). Put what comes back in the request\'s `returns`: a read returns its data; a step that is started ("trigger/start/run X") returns its outcome, never data (e.g. "parsing complete"), and the data it produces is written to a datastore. Use null for fire-and-forget messages (store, notify, deliver, send, pass).',
      "Datastores never start interactions, and every datastore needs at least one writer and one reader. Data that is read must come from somewhere: model who loads it (e.g. ComplianceTeam -> ExistingControlsDB: load current controls). `intentional_reason` is only for a store that is written but never read (e.g. an audit archive); otherwise null.",
      "Give every non-actor element a short `layer` (2-5 layers in total, e.g. Ingestion, Analysis, Reporting, Data); actors get null.",
      "Aim for 3-15 elements.",
    ].join("\n");

    // Follow-ups are change requests: the conversation's first prompt stays the requirements to meet.
    const requirements = previous?.requirements ?? previous?.prompt;
    const history =
      previous && requirements
        ? [
            `Original requirements:\n${requirements}`,
            ...(previous.prompt !== requirements ? [`Previous change request:\n${previous.prompt}`] : []),
          ]
        : [];

    let user: string;
    if (previous?.architecture) {
      user = [
        `Current architecture:\n${JSON.stringify(previous.architecture)}`,
        ...history,
        `Change request:\n${prompt}`,
        ...feedbackSection(previous),
        "Return the complete updated architecture. Keep element names that still apply exactly as they are; add, remove or rename elements only where the change request or feedback requires it.",
      ].join("\n\n");
    } else if (previous) {
      user = [
        ...history,
        `Previous diagrams (for context only; they may be inconsistent):\n${JSON.stringify(previous.diagrams)}`,
        `Change request:\n${prompt}`,
        ...feedbackSection(previous),
        "Return one complete, consistent architecture for the system including the change request.",
      ].join("\n\n");
    } else {
      user = `Requirements:\n${prompt}`;
    }

    const result = await this.completeJson(system, user, LlmArchitectureResponseSchema, {
      check: (r) => architectureIssues(r.architecture, [requirements, prompt].filter(Boolean).join("\n")),
      feedbackHeader: "The architecture model has gaps:",
      maxAttempts: DIAGRAM_ATTEMPTS,
      // Every diagram is drawn from this model, so it gets deeper reasoning than the other calls.
      reasoningEffort: this.tuning.architectureReasoningEffort,
      progress: {
        report: onProgress,
        stage: "architecture",
        label: previous ? "Revising the architecture model" : "Designing the architecture model",
      },
    });
    const { elements, interactions } = result.data.architecture;
    onProgress({
      stage: "architecture",
      message: `Architecture model ready: ${elements.length} elements, ${interactions.length} interactions`,
      details: elements.map((e) => `${e.name} (${e.kind})`),
    });
    return { architecture: result.data.architecture, trace: this.trace(system, user, result) };
  }

  /** Step 2: every requested diagram, drawn from the architecture model with its exact names. */
  async generateDiagrams(
    prompt: string,
    types: DiagramType[],
    architecture: ArchitectureModel,
    previous?: PreviousGeneration,
    onProgress: ProgressReporter = noProgress,
  ): Promise<GeneratedDiagrams> {
    const typeSpec = types.map((t) => `- ${t}: engine=${ENGINE_BY_TYPE[t]}`).join("\n");
    const engines = [...new Set(types.map((t) => ENGINE_BY_TYPE[t]))];

    const system = [
      "You are a senior software architect who writes UML 2.x diagrams as code.",
      'Respond with ONLY a JSON object: {"diagrams":[{"type":string,"title":string,"source":string}]}.',
      "Return exactly one diagram per requested type, using the listed engine syntax for `source`.",
      ...engines.map((e) => SYNTAX_HINTS[e]),
      "In `source`, put each statement on its own line using normal JSON escaping (\\n once); never double-escape.",
      "All diagrams describe the SAME system and must be consistent with each other. The architecture model below is the single source of truth:",
      JSON.stringify(architecture),
      "Use the element names exactly as identifiers: no aliases, no renaming, no extra system parts. Data (documents, tables, reports) appears only as message or arrow labels.",
      VIEW_RULES,
    ].join("\n");

    const user = previous
      ? [
          ...(previous.requirements ? [`Original requirements:\n${previous.requirements}`] : []),
          `Change request:\n${prompt}`,
          "This updates an existing design: the architecture above already includes the change. Redraw the diagrams from it; don't copy earlier diagrams.",
          ...feedbackSection(previous),
          `Requested diagram types:\n${typeSpec}`,
        ].join("\n\n")
      : `Requirements:\n${prompt}\n\nRequested diagram types:\n${typeSpec}`;

    const ResponseSchema = LlmDiagramsResponseSchema.refine(
      (r) => types.every((t) => r.diagrams.some((d) => d.type === t)),
      { message: `Must include every requested type: ${types.join(", ")}` },
    );
    const pick = (all: LlmDiagram[]) => types.map((t) => all.find((d) => d.type === t)!);

    const result = await this.completeJson(system, user, ResponseSchema, {
      check: (r) => checkConsistency(pick(r.diagrams), previous?.diagrams),
      feedbackHeader: "The diagrams don't yet follow the change request:",
      maxAttempts: DIAGRAM_ATTEMPTS,
      progress: { report: onProgress, stage: "diagrams", label: `Drawing ${types.join(", ")} with the model` },
    });
    return { diagrams: pick(result.data.diagrams), trace: this.trace(system, user, result) };
  }

  /** Asks the model to fix a diagram that the renderer rejected. */
  async repairDiagram(engine: Engine, source: string, renderError: string): Promise<string> {
    const system = [
      "You fix syntax errors in diagram code. Keep every name and relationship; change only the syntax.",
      'Respond with ONLY a JSON object: {"source": string} containing the corrected diagram.',
      SYNTAX_HINTS[engine],
    ].join("\n");
    const user = `Engine: ${engine}\n\nRenderer error:\n${renderError}\n\nSource:\n${source}`;
    const { data } = await this.completeJson(system, user, LlmRepairResponseSchema);
    return data.source;
  }

  /** Set once the provider rejects streaming for these requests; later calls go straight to non-streaming. */
  private streamingUnsupported = false;

  /**
   * Runs one completion as a stream, passing the model's reasoning and answer tokens to `onText`
   * in small batches (so the client gets a few updates a second, not one per token). Returns the
   * full answer. Falls back to a plain request if the provider refuses to stream this request.
   */
  private async streamCompletion(
    request: ChatCompletionCreateParamsNonStreaming,
    onText: (channel: "reasoning" | "answer", text: string) => void,
  ): Promise<string> {
    const client = this.client!;
    // gpt-oss exposes its reasoning via include_reasoning; qwen3 needs reasoning_format "parsed".
    const reasoningOutput = /gpt-oss/i.test(this.model)
      ? { include_reasoning: true }
      : REASONING_MODELS.test(this.model)
        ? { reasoning_format: "parsed" as const }
        : {};

    let stream: AsyncIterable<Groq.Chat.ChatCompletionChunk>;
    try {
      const streaming: ChatCompletionCreateParamsStreaming = { ...request, ...reasoningOutput, stream: true };
      stream = await client.chat.completions.create(streaming);
    } catch (err) {
      if (!(err instanceof APIError) || err.status !== 400 || !/stream/i.test(err.message)) throw err;
      this.streamingUnsupported = true;
      console.warn(`Streaming rejected by ${this.model}; using non-streaming requests: ${err.message}`);
      return (await client.chat.completions.create(request)).choices[0]?.message?.content ?? "";
    }

    let content = "";
    const pending = { reasoning: "", answer: "" };
    let lastFlush = performance.now();
    const flush = () => {
      for (const channel of ["reasoning", "answer"] as const) {
        if (pending[channel]) onText(channel, pending[channel]);
        pending[channel] = "";
      }
      lastFlush = performance.now();
    };
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as { content?: string | null; reasoning?: string | null } | undefined;
      if (delta?.reasoning) pending.reasoning += delta.reasoning;
      if (delta?.content) {
        content += delta.content;
        pending.answer += delta.content;
      }
      if (performance.now() - lastFlush > 100) flush();
    }
    flush();
    return content;
  }

  /** The accepted exchange of one completion, as recorded for RL training. */
  private trace(system: string, user: string, result: JsonCompletion<unknown>): GenerationTrace {
    return {
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "assistant", content: result.content },
      ],
      attempts: result.attempts,
      latencyMs: result.latencyMs,
      issues: result.issues,
    };
  }

  /**
   * Calls the model until the reply passes `schema`, feeding validation errors back.
   * `check` adds soft issues (e.g. consistency): they are fed back too while attempts remain,
   * but the last schema-valid reply is accepted with its issues rather than failing the request.
   */
  private async completeJson<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
    options: {
      check?: (data: T) => string[];
      feedbackHeader?: string;
      maxAttempts?: number;
      reasoningEffort?: ReasoningEffort;
      /** Streams each attempt and each round of soft-issue feedback to the client. */
      progress?: { report: ProgressReporter; stage: ProgressEvent["stage"]; label: string };
    } = {},
  ): Promise<JsonCompletion<T>> {
    if (!this.client) throw HttpError.unavailable("GROQ_API_KEY is not configured");
    // Soft-issue feedback may use extra attempts; schema failures keep the base budget.
    const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    const softBudgetMs = this.tuning.softRetryBudgetMs ?? DEFAULT_SOFT_RETRY_BUDGET_MS;
    const effort = options.reasoningEffort ?? this.tuning.reasoningEffort;
    const reasoning = effort && REASONING_MODELS.test(this.model) ? { reasoning_effort: effort } : {};

    const base: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    // Only the latest reply and its feedback ride along on a retry: resending every earlier attempt
    // grows the request past the provider's per-request token limit (Groq free tier: 8k TPM).
    let followUp: Groq.Chat.ChatCompletionMessageParam[] = [];
    const retryWith = (content: string, feedback: string) => {
      followUp = [
        { role: "assistant", content },
        { role: "user", content: feedback },
      ];
    };
    let lastError = "";
    let schemaFailures = 0;
    let calls = 0;
    let lastValid: Omit<JsonCompletion<T>, "latencyMs" | "attempts"> | undefined;
    const started = performance.now();
    const done = (valid: Omit<JsonCompletion<T>, "latencyMs" | "attempts">): JsonCompletion<T> => ({
      ...valid,
      attempts: calls, // every call made, including ones whose reply was discarded
      latencyMs: Math.round(performance.now() - started),
    });
    const { progress } = options;
    const keep = (issues: string[], why: string) =>
      progress?.report({
        stage: "checks",
        message: `Keeping the best version (${issues.length} gap(s) left) because ${why}`,
        details: issues,
      });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!lastValid && schemaFailures >= MAX_ATTEMPTS) break;
      calls = attempt;
      progress?.report({ stage: progress.stage, message: attempt === 1 ? progress.label : `${progress.label} (attempt ${attempt})` });
      let content: string;
      try {
        const request = {
          model: this.model,
          messages: [...base, ...followUp],
          temperature: 0.2,
          response_format: { type: "json_object" as const },
          ...reasoning,
        };
        const call = attempt === 1 ? progress?.label : `${progress?.label} (attempt ${attempt})`;
        const think = progress?.report.thinking;
        content =
          think && progress && call && !this.streamingUnsupported
            ? await this.streamCompletion(request, (channel, text) => think({ stage: progress.stage, call, channel, text }))
            : ((await this.client.chat.completions.create(request)).choices[0]?.message?.content ?? "");
      } catch (err) {
        // A retry that hits the rate limit shouldn't cost the user a reply we already have.
        if (lastValid && isRateLimited(err)) {
          keep(lastValid.issues, "the model's rate limit was reached");
          return done(lastValid);
        }
        // JSON mode rejects a reply that isn't valid JSON: that's a bad answer to retry, not an outage.
        if (isInvalidJson(err)) {
          schemaFailures++;
          lastError = "Response was not valid JSON.";
          progress?.report({ stage: progress.stage, message: "The reply wasn't valid JSON; asking again" });
          continue;
        }
        throw toHttpError(err);
      }

      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        schemaFailures++;
        lastError = "Response was not valid JSON.";
        progress?.report({ stage: progress.stage, message: "The reply wasn't valid JSON; asking again" });
        retryWith(content, lastError);
        continue;
      }

      const result = schema.safeParse(json);
      if (!result.success) {
        schemaFailures++;
        lastError = z.prettifyError(result.error);
        progress?.report({ stage: progress.stage, message: "The reply didn't match the expected format; asking again" });
        retryWith(content, `Your JSON failed validation:\n${lastError}\nReturn corrected JSON only.`);
        continue;
      }

      const issues = options.check?.(result.data) ?? [];
      // Keep the reply with the fewest issues: a retry can fix one gap and open two.
      if (!lastValid || issues.length <= lastValid.issues.length) lastValid = { data: result.data, content, issues };
      const outOfTime = performance.now() - started > softBudgetMs;
      if (issues.length === 0 || attempt === maxAttempts || outOfTime) {
        if (options.check && lastValid.issues.length === 0) progress?.report({ stage: "checks", message: "All checks passed" });
        else if (lastValid.issues.length) keep(lastValid.issues, outOfTime ? "the time budget is used up" : "no attempts are left");
        return done(lastValid);
      }
      progress?.report({
        stage: "checks",
        message: `Found ${issues.length} gap(s); asking the model to fix them`,
        details: issues,
      });
      retryWith(
        content,
        `${options.feedbackHeader ?? "Fix these issues:"}\n- ${issues.join("\n- ")}\nReturn the complete corrected JSON only.`,
      );
    }

    // A later attempt broke the schema: fall back to the last reply that passed it.
    if (lastValid) return done(lastValid);
    throw HttpError.badGateway("LLM returned invalid output", lastError);
  }
}
