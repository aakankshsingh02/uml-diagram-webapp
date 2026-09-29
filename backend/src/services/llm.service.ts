import Groq from "groq-sdk";
import { z } from "zod";
import { HttpError } from "../lib/http-error.js";
import {
  ENGINE_BY_TYPE,
  LlmDiagramsResponseSchema,
  LlmRepairResponseSchema,
  type DiagramType,
  type Engine,
  type LlmDiagram,
} from "../schemas/diagram.schema.js";

const MAX_ATTEMPTS = 2;

const SYNTAX_HINTS: Record<Engine, string> = {
  mermaid:
    "Mermaid: class -> `classDiagram`, sequence -> `sequenceDiagram`, state_machine -> `stateDiagram-v2`, activity -> `flowchart TD`. No ``` fences.",
  plantuml: "PlantUML: wrap every diagram in `@startuml` / `@enduml`. No ``` fences.",
  excalidraw: "Excalidraw JSON scene.",
};

export interface PreviousGeneration {
  prompt: string;
  diagrams: Pick<LlmDiagram, "type" | "title" | "source">[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The successful exchange behind a generation, kept as RL training data. */
export interface GenerationTrace {
  model: string;
  /** system, user, and the assistant reply that passed validation (failed attempts excluded). */
  messages: ChatMessage[];
  attempts: number;
  latencyMs: number;
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
}

/** What DiagramService needs from the model; lets tests substitute a fake. */
export type DiagramLlm = Pick<LlmService, "generateDiagrams" | "repairDiagram">;

export class LlmService {
  private readonly client: Groq | null;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: Groq,
  ) {
    this.client = client ?? (apiKey ? new Groq({ apiKey }) : null);
  }

  async generateDiagrams(
    prompt: string,
    types: DiagramType[],
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
      "Keep diagrams focused and readable; prefer clear names over exhaustive detail.",
    ].join("\n");

    const user = previous
      ? [
          "Update the existing design according to the new requirements. Keep what still applies.",
          `Previous requirements:\n${previous.prompt}`,
          `Previous diagrams:\n${JSON.stringify(previous.diagrams)}`,
          `New requirements:\n${prompt}`,
          `Requested diagram types:\n${typeSpec}`,
        ].join("\n\n")
      : `Requirements:\n${prompt}\n\nRequested diagram types:\n${typeSpec}`;

    const ResponseSchema = LlmDiagramsResponseSchema.refine(
      (r) => types.every((t) => r.diagrams.some((d) => d.type === t)),
      { message: `Must include every requested type: ${types.join(", ")}` },
    );

    const result = await this.completeJson(system, user, ResponseSchema);
    return {
      diagrams: types.map((t) => result.data.diagrams.find((d) => d.type === t)!),
      trace: {
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
          { role: "assistant", content: result.content },
        ],
        attempts: result.attempts,
        latencyMs: result.latencyMs,
      },
    };
  }

  /** Asks the model to fix a diagram that the renderer rejected. */
  async repairDiagram(engine: Engine, source: string, renderError: string): Promise<string> {
    const system = [
      "You fix syntax errors in diagram code.",
      'Respond with ONLY a JSON object: {"source": string} containing the corrected diagram.',
      SYNTAX_HINTS[engine],
    ].join("\n");
    const user = `Engine: ${engine}\n\nRenderer error:\n${renderError}\n\nSource:\n${source}`;
    const { data } = await this.completeJson(system, user, LlmRepairResponseSchema);
    return data.source;
  }

  private async completeJson<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
  ): Promise<JsonCompletion<T>> {
    if (!this.client) throw HttpError.unavailable("GROQ_API_KEY is not configured");

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    let lastError = "";
    const started = performance.now();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
        lastError = "Response was not valid JSON.";
        messages.push({ role: "assistant", content }, { role: "user", content: lastError });
        continue;
      }

      const result = schema.safeParse(json);
      if (result.success) {
        return {
          data: result.data,
          content,
          attempts: attempt,
          latencyMs: Math.round(performance.now() - started),
        };
      }

      lastError = z.prettifyError(result.error);
      messages.push(
        { role: "assistant", content },
        { role: "user", content: `Your JSON failed validation:\n${lastError}\nReturn corrected JSON only.` },
      );
    }

    throw HttpError.badGateway("LLM returned invalid output", lastError);
  }
}
