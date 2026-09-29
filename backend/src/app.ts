import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.js";
import { createContainer, type Container } from "./container.js";
import { createRouter } from "./routes/index.js";

export function createApp(container: Container = createContainer()) {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()) }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", createRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
