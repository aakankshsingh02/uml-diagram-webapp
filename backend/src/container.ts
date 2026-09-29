import { env } from "./config/env.js";
import { AuthController } from "./controllers/auth.controller.js";
import { ConversationController } from "./controllers/conversation.controller.js";
import { DiagramController } from "./controllers/diagram.controller.js";
import { FeedbackController } from "./controllers/feedback.controller.js";
import { HealthController } from "./controllers/health.controller.js";
import { TrainingController } from "./controllers/training.controller.js";
import { pool } from "./db/pool.js";
import { ConversationRepository } from "./repositories/conversation.repository.js";
import { DiagramRepository } from "./repositories/diagram.repository.js";
import { FeedbackRepository } from "./repositories/feedback.repository.js";
import { GenerationRepository } from "./repositories/generation.repository.js";
import { SessionRepository } from "./repositories/session.repository.js";
import { UserRepository } from "./repositories/user.repository.js";
import { AuthService } from "./services/auth.service.js";
import { ConversationService } from "./services/conversation.service.js";
import { DiagramService } from "./services/diagram.service.js";
import { FeedbackService } from "./services/feedback.service.js";
import { HealthService } from "./services/health.service.js";
import { KrokiService } from "./services/kroki.service.js";
import { LlmService, type DiagramLlm } from "./services/llm.service.js";
import { TrainingService } from "./services/training.service.js";

export interface ContainerOverrides {
  llm?: DiagramLlm;
  kroki?: Pick<KrokiService, "renderSvg" | "isHealthy">;
  trainingToken?: string;
}

// Manual dependency wiring: repositories -> services -> controllers.
export function createContainer(overrides: ContainerOverrides = {}) {
  const userRepository = new UserRepository(pool);
  const conversationRepository = new ConversationRepository(pool);
  const diagramRepository = new DiagramRepository(pool);
  const feedbackRepository = new FeedbackRepository(pool);
  const generationRepository = new GenerationRepository(pool);
  const sessionRepository = new SessionRepository(pool);

  const kroki = overrides.kroki ?? new KrokiService(env.KROKI_URL);
  const llm = overrides.llm ?? new LlmService(env.GROQ_API_KEY, env.GROQ_MODEL);

  const authService = new AuthService(userRepository, sessionRepository, env.SESSION_TTL_DAYS * 86_400_000);
  const diagramService = new DiagramService(
    conversationRepository,
    diagramRepository,
    generationRepository,
    llm,
    kroki,
  );
  const conversationService = new ConversationService(conversationRepository, diagramRepository);
  const feedbackService = new FeedbackService(diagramRepository, feedbackRepository);
  const trainingService = new TrainingService(generationRepository);
  const healthService = new HealthService(pool, kroki, Boolean(overrides.llm ?? env.GROQ_API_KEY));

  return {
    trainingToken: overrides.trainingToken ?? env.TRAINING_API_TOKEN,
    auth: authService,
    controllers: {
      auth: new AuthController(authService),
      diagram: new DiagramController(diagramService),
      conversation: new ConversationController(conversationService),
      feedback: new FeedbackController(feedbackService),
      training: new TrainingController(trainingService),
      health: new HealthController(healthService),
    },
  };
}

export type Container = ReturnType<typeof createContainer>;
