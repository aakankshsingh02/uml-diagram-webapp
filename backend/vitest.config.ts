import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://uml:uml_password@localhost:5432/uml_diagrams_test";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      TRAINING_API_TOKEN: "test-training-token-0123456789abcdef",
      GROQ_API_KEY: "",
    },
  },
});
