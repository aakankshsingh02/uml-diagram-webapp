import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import { bearerToken } from "./require-auth.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Guards a route with a static bearer token; 503 when the server has none configured. */
export const requireBearer =
  (token: string, name: string): RequestHandler =>
  (req, _res, next) => {
    if (!token) throw HttpError.unavailable(`${name} is not configured`);

    const presented = bearerToken(req);
    // Hash both sides so the comparison is constant-time regardless of length.
    if (!presented || !timingSafeEqual(digest(presented), digest(token))) {
      throw new HttpError(401, "Unauthorized");
    }
    next();
  };
