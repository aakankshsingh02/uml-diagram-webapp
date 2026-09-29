import type { Request, Response } from "express";
import { currentUser } from "../middlewares/require-auth.js";
import type { LoginRequest, SignupRequest } from "../schemas/auth.schema.js";
import { toUserDto, type AuthService } from "../services/auth.service.js";

export class AuthController {
  constructor(private readonly service: AuthService) {}

  signup = async (req: Request<unknown, unknown, SignupRequest>, res: Response) => {
    res.status(201).json(await this.service.signup(req.body));
  };

  login = async (req: Request<unknown, unknown, LoginRequest>, res: Response) => {
    res.json(await this.service.login(req.body));
  };

  logout = async (req: Request, res: Response) => {
    await this.service.logout(req.sessionToken!);
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    res.json({ user: toUserDto(currentUser(req)) });
  };
}
