import type { Request, Response } from "express";
import { TrajectoryQuerySchema, type AckRequest } from "../schemas/training.schema.js";
import type { TrainingService } from "../services/training.service.js";

export class TrainingController {
  constructor(private readonly service: TrainingService) {}

  /** NDJSON, one ART trajectory per line; X-Export-As-Of must be echoed back on ack. */
  exportTrajectories = async (req: Request, res: Response) => {
    const { limit, kind } = TrajectoryQuerySchema.parse(req.query);
    const { asOf, trajectories } = await this.service.exportTrajectories(limit, kind);
    res
      .set("X-Export-As-Of", asOf)
      .type("application/x-ndjson")
      .send(trajectories.map((t) => JSON.stringify(t) + "\n").join(""));
  };

  acknowledge = async (req: Request<unknown, unknown, AckRequest>, res: Response) => {
    res.json(await this.service.acknowledge(req.body.ids, req.body.as_of));
  };
}
