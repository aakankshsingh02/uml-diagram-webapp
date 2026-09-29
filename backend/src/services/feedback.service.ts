import { HttpError } from "../lib/http-error.js";
import type { DiagramRepository } from "../repositories/diagram.repository.js";
import type { FeedbackRepository } from "../repositories/feedback.repository.js";
import type { FeedbackRequest } from "../schemas/feedback.schema.js";

export class FeedbackService {
  constructor(
    private readonly diagrams: DiagramRepository,
    private readonly feedback: FeedbackRepository,
  ) {}

  /** Only the conversation owner may rate; anyone else gets the same 404 as a missing diagram. */
  async submit(userId: string, diagramId: string, input: FeedbackRequest) {
    const owner = await this.diagrams.findOwner(diagramId);
    if (!owner || owner.user_id !== userId) {
      throw HttpError.notFound("Diagram not found");
    }

    const saved = await this.feedback.upsert(diagramId, userId, input.rating, input.comment);
    return { id: saved.id, diagram_id: saved.diagram_id, rating: saved.rating, comment: saved.comment };
  }
}
