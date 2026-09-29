import type { Request, Response } from "express";
import type { HealthService } from "../services/health.service.js";

export class HealthController {
  constructor(private readonly service: HealthService) {}

  check = async (_req: Request, res: Response) => {
    const status = await this.service.check();
    res.status(status.ok ? 200 : 503).json(status);
  };
}
