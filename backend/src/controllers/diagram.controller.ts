import type { Request, Response } from "express";
import { currentUser } from "../middlewares/require-auth.js";
import { toErrorResponse } from "../middlewares/error-handler.js";
import type { GenerateDiagramsRequest } from "../schemas/diagram.schema.js";
import type { DiagramService } from "../services/diagram.service.js";
import type { ProgressEvent, ProgressReporter, ThinkingChunk } from "../services/progress.js";

export class DiagramController {
  constructor(private readonly service: DiagramService) {}

  /**
   * JSON by default. With `Accept: application/x-ndjson` the response streams one JSON line per
   * progress step and per batch of the model's words (`thinking`), then a final `result` (or
   * `error`) line carrying the usual status and body.
   */
  generate = async (req: Request<unknown, unknown, GenerateDiagramsRequest>, res: Response) => {
    const userId = currentUser(req).id;
    if (!req.get("accept")?.includes("application/x-ndjson")) {
      res.status(201).json(await this.service.generate(userId, req.body));
      return;
    }

    // The status line goes out with the first byte, so the real outcome travels in the last event.
    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const started = Date.now();
    const send = (event: object) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    const reporter: ProgressReporter = Object.assign(
      (progress: ProgressEvent) => send({ type: "progress", ...progress, elapsed_ms: Date.now() - started }),
      { thinking: (chunk: ThinkingChunk) => send({ type: "thinking", ...chunk, elapsed_ms: Date.now() - started }) },
    );
    try {
      const result = await this.service.generate(userId, req.body, reporter);
      send({ type: "result", status: 201, body: result });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      send({ type: "error", status, body });
    }
    res.end();
  };
}
