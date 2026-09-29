import type { RequestHandler } from "express";
import type { z } from "zod";

/** Parses req.body with a Zod schema and replaces it with the typed, normalized result. */
export const validateBody =
  (schema: z.ZodType): RequestHandler =>
  (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
