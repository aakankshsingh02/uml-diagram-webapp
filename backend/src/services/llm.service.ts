import Groq from "groq-sdk";
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
import { checkConsistency } from "./consistency.js";

const MAX_ATTEMPTS = 2;
/** Diagram generation gets one extra attempt for consistency feedback. */
const DIAGRAM_ATTEMPTS = 3;

const SYNTAX_HINTS: Record<Engine, string> = {
  mermaid:
    "Mermaid: class -> `classDiagram`, sequence -> `sequenceDiagram`, state_machine -> `stateDiagram-v2`, activity -> `flowchart TD`. No ``` fences.",
  plantuml: "PlantUML: wrap every diagram in `@startuml` / `@enduml`. No ``` fences.",
  excalidraw: "Excalidraw JSON scene.",
};

const VIEW_RULES = [
  "Sequence: declare every element as a participant (`actor Name` for actors, `participant Name` otherwise), in model order, with no aliases; draw the messages in the order of the interactions.",
  "Component/communication: show every element exactly once (actor -> `actor Name`, datastore -> `database Name`, service/external -> `component Name`), connected as in the interactions.",
  "Other diagram types: use only element names from the model for anything that represents a system part.",
].join("\n");

export interface PreviousGeneration {
  prompt: string;
  /** The version's architecture model; null for versions created before models existed. */
  architecture: ArchitectureModel | null;
  diagrams: Pick<LlmDiagram, "type" | "title" | "source">[];
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

interface JsonCompletion<T> {
  data: T;
  content: string;
  attempts: number;
  latencyMs: number;
  issues: string[];
}

/** What DiagramService needs from the model; lets tests substitute a fake. */
export type DiagramLlm = Pick<LlmService, "designArchitecture" | "generateDiagrams" | "repairDiagram">;

export class LlmService {
  private readonly client: Groq | null;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: Groq,
  ) {
    this.client = client ?? (apiKey ? new Groq({ apiKey }) : null);
  }

  /**
   * Step 1: the system's elements and interactions, the shared source every diagram is drawn
   * from. On an update the previous model is revised rather than recreated.
   */
  async designArchitecture(prompt: string, previous?: PreviousGeneration): Promise<ArchitectureModel> {
    const system = [
      "You are a senior software architect. Model the system described by the user as elements and interactions.",
      'Respond with ONLY a JSON object: {"architecture":{"elements":[{"name":string,"kind":"actor"|"service"|"datastore"|"external","description":string}],"interactions":[{"from":string,"to":string,"message":string}]}}.',
      "Element names are PascalCase identifiers (letters and digits only), e.g. CircularFetcher.",
      "Elements are active parts: people (actor), services/modules (service), databases (datastore), third-party systems (external).",
      "Data such as documents, tables, reports and files are NOT elements; mention them inside interaction messages.",
      "Every element must take part in at least one interaction. List interactions in the order they happen in the main flow.",
      "Aim for 3-15 elements.",
    ].join("\n");

    let user: string;
    if (previous?.architecture) {
      user = [
        `Current architecture:\n${JSON.stringify(previous.architecture)}`,
        `Previous requirements:\n${previous.prompt}`,
        `Change request:\n${prompt}`,
        "Return the complete updated architecture. Keep element names that still apply exactly as they are; add, remove or rename elements only where the change request requires it.",
      ].join("\n\n");
    } else if (previous) {
      user = [
        `Previous requirements:\n${previous.prompt}`,
        `Previous diagrams (for context only; they may be inconsistent):\n${JSON.stringify(previous.diagrams)}`,
        `Change request:\n${prompt}`,
        "Return one complete, consistent architecture for the system including the change request.",
      ].join("\n\n");
    } else {
      user = `Requirements:\n${prompt}`;
    }

    const { data } = await this.completeJson(system, user, LlmArchitectureResponseSchema);
    return data.architecture;
  }

  /** Step 2: every requested diagram, drawn from the architecture model with its exact names. */
  async generateDiagrams(
    prompt: string,
    types: DiagramType[],
    architecture: ArchitectureModel,
    previous?: PreviousGeneration,
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
          `Change request:\n${prompt}`,
          "This updates an existing design: the architecture above already includes the change. Redraw the diagrams from it; don't copy earlier diagrams.",
          `Requested diagram types:\n${typeSpec}`,
        ].join("\n\n")
      : `Requirements:\n${prompt}\n\nRequested diagram types:\n${typeSpec}`;

    const ResponseSchema = LlmDiagramsResponseSchema.refine(
      (r) => types.every((t) => r.diagrams.some((d) => d.type === t)),
      { message: `Must include every requested type: ${types.join(", ")}` },
    );
    const pick = (all: LlmDiagram[]) => types.map((t) => all.find((d) => d.type === t)!);

    const result = await this.completeJson(system, user, ResponseSchema, {
      check: (r) => checkConsistency(pick(r.diagrams), architecture, previous?.diagrams),
      feedbackHeader: "The diagrams don't yet follow the architecture model and the change request:",
      maxAttempts: DIAGRAM_ATTEMPTS,
    });
    return {
      diagrams: pick(result.data.diagrams),
      trace: {
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
          { role: "assistant", content: result.content },
        ],
        attempts: result.attempts,
        latencyMs: result.latencyMs,
        issues: result.issues,
      },
    };
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

  /**
   * Calls the model until the reply passes `schema`, feeding validation errors back.
   * `check` adds soft issues (e.g. consistency): they are fed back too while attempts remain,
   * but the last schema-valid reply is accepted with its issues rather than failing the request.
   */
  private async completeJson<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
    options: { check?: (data: T) => string[]; feedbackHeader?: string; maxAttempts?: number } = {},
  ): Promise<JsonCompletion<T>> {
    if (!this.client) throw HttpError.unavailable("GROQ_API_KEY is not configured");
    // Soft-issue feedback may use extra attempts; schema failures keep the base budget.
    const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
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

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!lastValid && schemaFailures >= MAX_ATTEMPTS) break;
      calls = attempt;
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.2,
        response_format: { type: "json_object" },
      });
      const content = completion.choices[0]?.message?.content ?? "";

      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        schemaFailures++;
        lastError = "Response was not valid JSON.";
        messages.push({ role: "assistant", content }, { role: "user", content: lastError });
        continue;
      }

      const result = schema.safeParse(json);
      if (!result.success) {
        schemaFailures++;
        lastError = z.prettifyError(result.error);
        messages.push(
          { role: "assistant", content },
          { role: "user", content: `Your JSON failed validation:\n${lastError}\nReturn corrected JSON only.` },
        );
        continue;
      }

      const issues = options.check?.(result.data) ?? [];
      lastValid = { data: result.data, content, issues };
      if (issues.length === 0 || attempt === maxAttempts) return done(lastValid);
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `${options.feedbackHeader ?? "Fix these issues:"}\n- ${issues.join("\n- ")}\nReturn the complete corrected JSON only.`,
        },
      );
    }

    // A later attempt broke the schema: fall back to the last reply that passed it.
    if (lastValid) return done(lastValid);
    throw HttpError.badGateway("LLM returned invalid output", lastError);
  }
}
