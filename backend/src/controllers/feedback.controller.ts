import type { Request, Response } from "express";
import { currentUser } from "../middlewares/require-auth.js";
import { DiagramParamsSchema, type FeedbackRequest } from "../schemas/feedback.schema.js";
import type { FeedbackService } from "../services/feedback.service.js";

export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  submit = async (req: Request<Record<string, string>, unknown, FeedbackRequest>, res: Response) => {
    const { id } = DiagramParamsSchema.parse(req.params);
    res.json(await this.service.submit(currentUser(req).id, id, req.body));
  };
}
