import type { Request, Response } from "express";
import { currentUser } from "../middlewares/require-auth.js";
import type { GenerateDiagramsRequest } from "../schemas/diagram.schema.js";
import type { DiagramService } from "../services/diagram.service.js";

export class DiagramController {
  constructor(private readonly service: DiagramService) {}

  generate = async (req: Request<unknown, unknown, GenerateDiagramsRequest>, res: Response) => {
    const result = await this.service.generate(currentUser(req).id, req.body);
    res.status(201).json(result);
  };
}
