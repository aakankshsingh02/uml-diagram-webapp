import { withTransaction } from "../db/transaction.js";
import { HttpError } from "../lib/http-error.js";
import type { ConversationRepository } from "../repositories/conversation.repository.js";
import type { DiagramRepository, NewDiagram } from "../repositories/diagram.repository.js";
import type { FeedbackRepository } from "../repositories/feedback.repository.js";
import type { GenerationRepository } from "../repositories/generation.repository.js";
import { ArchitectureModelSchema } from "../schemas/architecture.schema.js";
import { ENGINE_BY_TYPE, type GenerateDiagramsRequest, type LlmDiagram } from "../schemas/diagram.schema.js";
import type { DiagramRenderer } from "./kroki.service.js";
import type { DiagramLlm, PreviousGeneration } from "./llm.service.js";
import { noProgress, type ProgressReporter } from "./progress.js";
import { isProjected, projectDiagram } from "./projection.js";

export class DiagramService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly diagrams: DiagramRepository,
    private readonly generations: GenerationRepository,
    private readonly feedback: FeedbackRepository,
    private readonly llm: DiagramLlm,
    private readonly kroki: DiagramRenderer,
  ) {}

  /**
   * New conversation when no conversation_id is given; otherwise the prompt is treated as an
   * update: the previous version's architecture model is revised and the diagrams redrawn from it.
   */
  async generate(userId: string, input: GenerateDiagramsRequest, onProgress: ProgressReporter = noProgress) {
    let previous: PreviousGeneration | undefined;
    if (input.conversation_id) {
      onProgress({ stage: "context", message: "Loading the previous version and your feedback" });
      const conversation = await this.conversations.findById(input.conversation_id);
      if (!conversation || conversation.user_id !== userId) {
        throw HttpError.notFound("Conversation not found");
      }
      const latest = await this.conversations.findLatestMessage(conversation.id);
      if (latest) {
        const [prior, verdicts, original] = await Promise.all([
          this.diagrams.findByMessageId(latest.id),
          this.feedback.findForMessage(latest.id, userId),
          this.conversations.findFirstPrompt(conversation.id),
        ]);
        // A stored model that no longer validates (legacy/hand-edited row) falls back to "no model".
        const stored = ArchitectureModelSchema.safeParse(latest.architecture);
        previous = {
          prompt: latest.prompt,
          requirements: original ?? latest.prompt,
          architecture: stored.success ? stored.data : null,
          diagrams: prior.map((d) => ({ type: d.diagram_type, title: d.title, source: d.source })),
          // The user's ratings on the version being revised steer the revision.
          feedback: verdicts.map((f) => ({ type: f.diagram_type, rating: f.rating, comment: f.comment })),
        };
        onProgress({
          stage: "context",
          message: `Revising version ${latest.version}${verdicts.length ? ` with ${verdicts.length} piece(s) of your feedback` : ""}`,
          details: verdicts.map(
            (f) => `${f.diagram_type}: ${f.rating === 1 ? "👍" : "👎"}${f.comment ? ` ${f.comment}` : ""}`,
          ),
        });
      }
    }

    // One shared model first; the projected views are drawn from it by code, the rest by the LLM.
    const { architecture, trace: architectureTrace } = await this.llm.designArchitecture(
      input.prompt,
      previous,
      onProgress,
    );
    const drawnTypes = input.diagram_types.filter((t) => !isProjected(t));
    const projectedTypes = input.diagram_types.filter(isProjected);
    if (projectedTypes.length) {
      onProgress({ stage: "diagrams", message: `Drawing ${projectedTypes.join(", ")} from the model` });
    }
    const drawn = drawnTypes.length
      ? await this.llm.generateDiagrams(input.prompt, drawnTypes, architecture, previous, onProgress)
      : undefined;
    const drawnByType = new Map(drawn?.diagrams.map((d) => [d.type, d]));
    const ordered = input.diagram_types.map((type) =>
      isProjected(type)
        ? { diagram: projectDiagram(type, architecture), projected: true }
        : { diagram: drawnByType.get(type)!, projected: false },
    );
    // Render (and repair LLM-drawn syntax errors) all diagrams concurrently.
    onProgress({ stage: "render", message: `Rendering ${ordered.length} diagram(s)` });
    const rendered = await Promise.all(
      ordered.map((d) => this.renderWithRepair(d.diagram, d.projected, onProgress)),
    );

    onProgress({ stage: "save", message: "Saving the new version" });
    return withTransaction(async (tx) => {
      let conversationId = input.conversation_id;
      if (conversationId) {
        await this.conversations.touch(conversationId, tx);
      } else {
        conversationId = (await this.conversations.create(userId, input.prompt.slice(0, 80), tx)).id;
      }

      const message = await this.conversations.addMessage(
        conversationId,
        input.prompt,
        input.diagram_types,
        architecture,
        tx,
      );
      const saved = await this.diagrams.insertMany(message.id, rendered, tx);
      await this.generations.insert(message.id, architectureTrace, "architecture", tx);
      if (architectureTrace.issues.length) {
        console.warn(
          `conversation ${conversationId} v${message.version}: architecture accepted with ${architectureTrace.issues.length} gap(s)`,
          architectureTrace.issues,
        );
      }
      if (drawn) {
        await this.generations.insert(message.id, drawn.trace, "diagrams", tx);
        if (drawn.trace.issues.length) {
          console.warn(
            `conversation ${conversationId} v${message.version}: accepted with ${drawn.trace.issues.length} consistency issue(s)`,
            drawn.trace.issues,
          );
        }
      }

      return {
        conversation_id: conversationId,
        version: message.version,
        diagrams: saved.map(toDto),
      };
    });
  }

  /**
   * A projected diagram is never sent to LLM repair: the LLM could only drift it away from the model,
   * and a syntax error there is a projector bug to fix in code.
   */
  private async renderWithRepair(
    diagram: LlmDiagram,
    projected: boolean,
    onProgress: ProgressReporter = noProgress,
  ): Promise<NewDiagram> {
    const engine = ENGINE_BY_TYPE[diagram.type];
    let source = diagram.source;
    let result = await this.kroki.renderSvg(engine, source);
    let repaired = false;

    // A renderer outage says nothing about the diagram: retry once, never "repair" it.
    if (!result.ok && result.retryable) result = await this.kroki.renderSvg(engine, source);

    if (!result.ok && !result.retryable && !projected) {
      onProgress({ stage: "render", message: `The ${diagram.type} diagram has a syntax error; repairing it` });
      try {
        source = await this.llm.repairDiagram(engine, source, result.error);
        result = await this.kroki.renderSvg(engine, source);
        repaired = result.ok;
      } catch {
        // Keep the original render error; the client can still show the source.
      }
    }

    return {
      diagram_type: diagram.type,
      engine,
      title: diagram.title,
      source,
      svg: result.ok ? result.svg : null,
      render_error: result.ok ? null : result.error,
      repaired,
      projected,
    };
  }
}

export function toDto(d: NewDiagram & { id: string }) {
  return {
    id: d.id,
    type: d.diagram_type,
    engine: d.engine,
    title: d.title,
    source: d.source,
    svg: d.svg,
    render_error: d.render_error,
  };
}
