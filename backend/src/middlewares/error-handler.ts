import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError, z } from "zod";
import { HttpError } from "../lib/http-error.js";

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(HttpError.notFound("Route not found"));
};

/** The status and JSON body for an error; shared by the error middleware and streamed responses. */
export function toErrorResponse(err: unknown): { status: number; body: { error: string; details?: unknown } } {
  if (err instanceof ZodError) {
    return { status: 400, body: { error: "Validation failed", details: z.flattenError(err) } };
  }
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message, details: err.details } };
  }
  if (err instanceof SyntaxError && "body" in err) {
    return { status: 400, body: { error: "Malformed JSON body" } };
  }
  console.error(err);
  return { status: 500, body: { error: "Internal server error" } };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = toErrorResponse(err);
  res.status(status).json(body);
};
