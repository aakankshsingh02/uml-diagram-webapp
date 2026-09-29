import { Router } from "express";
import type { Container } from "../container.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { requireBearer } from "../middlewares/require-bearer.js";
import { validateBody } from "../middlewares/validate.js";
import { LoginRequestSchema, SignupRequestSchema } from "../schemas/auth.schema.js";
import { GenerateDiagramsRequestSchema } from "../schemas/diagram.schema.js";
import { FeedbackRequestSchema } from "../schemas/feedback.schema.js";
import { AckRequestSchema } from "../schemas/training.schema.js";

export function createRouter({ controllers: c, auth, trainingToken }: Container) {
  const router = Router();
  const trainerOnly = requireBearer(trainingToken, "TRAINING_API_TOKEN");
  const signedIn = requireAuth(auth);

  router.get("/health", c.health.check);

  router.post("/auth/signup", validateBody(SignupRequestSchema), c.auth.signup);
  router.post("/auth/login", validateBody(LoginRequestSchema), c.auth.login);
  router.post("/auth/logout", signedIn, c.auth.logout);
  router.get("/auth/me", signedIn, c.auth.me);

  router.post("/diagrams/generate", signedIn, validateBody(GenerateDiagramsRequestSchema), c.diagram.generate);
  router.post("/diagrams/:id/feedback", signedIn, validateBody(FeedbackRequestSchema), c.feedback.submit);
  router.get("/conversations", signedIn, c.conversation.list);
  router.get("/conversations/:id", signedIn, c.conversation.getById);

  router.get("/training/trajectories", trainerOnly, c.training.exportTrajectories);
  router.post("/training/trajectories/ack", trainerOnly, validateBody(AckRequestSchema), c.training.acknowledge);

  return router;
}
