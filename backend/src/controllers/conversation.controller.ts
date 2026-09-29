import type { Request, Response } from "express";
import { currentUser } from "../middlewares/require-auth.js";
import { ConversationParamsSchema } from "../schemas/diagram.schema.js";
import type { ConversationService } from "../services/conversation.service.js";

export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  list = async (req: Request, res: Response) => {
    res.json(await this.service.list(currentUser(req).id));
  };

  getById = async (req: Request, res: Response) => {
    const { id } = ConversationParamsSchema.parse(req.params);
    res.json(await this.service.getById(currentUser(req).id, id));
  };
}
