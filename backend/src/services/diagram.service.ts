import { withTransaction } from "../db/transaction.js";
import { HttpError } from "../lib/http-error.js";
import type { ConversationRepository } from "../repositories/conversation.repository.js";
import type { DiagramRepository, NewDiagram } from "../repositories/diagram.repository.js";
import type { GenerationRepository } from "../repositories/generation.repository.js";
import { ENGINE_BY_TYPE, type GenerateDiagramsRequest, type LlmDiagram } from "../schemas/diagram.schema.js";
import type { DiagramRenderer } from "./kroki.service.js";
import type { DiagramLlm, PreviousGeneration } from "./llm.service.js";

export class DiagramService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly diagrams: DiagramRepository,
    private readonly generations: GenerationRepository,
    private readonly llm: DiagramLlm,
    private readonly kroki: DiagramRenderer,
  ) {}

  /**
   * New conversation when no conversation_id is given; otherwise the prompt is treated as an
   * update and the previous version's diagrams are sent to the model as context.
   */
  async generate(userId: string, input: GenerateDiagramsRequest) {
    let previous: PreviousGeneration | undefined;
    if (input.conversation_id) {
      const conversation = await this.conversations.findById(input.conversation_id);
      if (!conversation || conversation.user_id !== userId) {
        throw HttpError.notFound("Conversation not found");
      }
      const latest = await this.conversations.findLatestMessage(conversation.id);
      if (latest) {
        const prior = await this.diagrams.findByMessageId(latest.id);
        previous = {
          prompt: latest.prompt,
          diagrams: prior.map((d) => ({ type: d.diagram_type, title: d.title, source: d.source })),
        };
      }
    }

    const { diagrams: generated, trace } = await this.llm.generateDiagrams(
      input.prompt,
      input.diagram_types,
      previous,
    );
    // Render (and repair on syntax errors) all diagrams concurrently.
    const rendered = await Promise.all(generated.map((d) => this.renderWithRepair(d)));

    return withTransaction(async (tx) => {
      let conversationId = input.conversation_id;
      if (conversationId) {
        await this.conversations.touch(conversationId, tx);
      } else {
        conversationId = (await this.conversations.create(userId, input.prompt.slice(0, 80), tx)).id;
      }

      const message = await this.conversations.addMessage(conversationId, input.prompt, input.diagram_types, tx);
      const saved = await this.diagrams.insertMany(message.id, rendered, tx);
      await this.generations.insert(message.id, trace, tx);

      return {
        conversation_id: conversationId,
        version: message.version,
        diagrams: saved.map(toDto),
      };
    });
  }

  private async renderWithRepair(diagram: LlmDiagram): Promise<NewDiagram> {
    const engine = ENGINE_BY_TYPE[diagram.type];
    let source = diagram.source;
    let result = await this.kroki.renderSvg(engine, source);
    let repaired = false;

    // A renderer outage says nothing about the model's output: retry once, never "repair" it.
    if (!result.ok && result.retryable) result = await this.kroki.renderSvg(engine, source);

    if (!result.ok && !result.retryable) {
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
