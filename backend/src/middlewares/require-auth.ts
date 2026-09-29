import type { Request, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import type { User } from "../repositories/user.repository.js";
import type { AuthService } from "../services/auth.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionToken?: string;
    }
  }
}

export function bearerToken(req: Request): string {
  return /^Bearer\s+(\S+)\s*$/i.exec(req.get("authorization") ?? "")?.[1] ?? "";
}

/** Resolves the session bearer token to `req.user`; 401 when missing, unknown or expired. */
export const requireAuth =
  (auth: Pick<AuthService, "authenticate">): RequestHandler =>
  async (req, _res, next) => {
    const token = bearerToken(req);
    const user = token ? await auth.authenticate(token) : null;
    if (!user) throw new HttpError(401, "Unauthorized");
    req.user = user;
    req.sessionToken = token;
    next();
  };

/** The user set by `requireAuth`; only call from routes mounted behind it. */
export function currentUser(req: Pick<Request, "user">): User {
  if (!req.user) throw new HttpError(401, "Unauthorized");
  return req.user;
}
