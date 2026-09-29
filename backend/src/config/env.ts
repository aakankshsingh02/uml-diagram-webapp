import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.url(),
  KROKI_URL: z.url().default("http://localhost:8000"),
  // Optional at boot so infra/health can run without a key; LLM calls fail with 503 until set.
  GROQ_API_KEY: z.string().default(""),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  // Reasoning depth for gpt-oss/qwen3 models; "low" keeps a generation to a few seconds per call.
  GROQ_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  // The architecture call shapes every diagram, so it reasons more by default.
  GROQ_ARCHITECTURE_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  // Stop retrying soft issues (flow gaps, unchanged diagrams) once a call has run this long.
  LLM_SOFT_RETRY_BUDGET_MS: z.coerce.number().int().min(0).default(15_000),
  // Bearer token for the RL trainer export; export endpoints return 503 while unset.
  TRAINING_API_TOKEN: z
    .string()
    .default("")
    .refine((t) => t === "" || t.length >= 32, "must be at least 32 characters (use a random value)"),
  // How long a login stays valid. Capped so expiry is always a valid date.
  SESSION_TTL_DAYS: z.coerce.number().positive().max(365).default(30),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;
