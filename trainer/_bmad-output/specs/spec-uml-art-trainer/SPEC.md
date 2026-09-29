---
id: SPEC-uml-art-trainer
companions:
  - reward-design.md
sources:
  - ../../../../task.md
  - ../../../../features.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# UML ART Trainer

## Why

This is a mandate. `task.md` case 3 says user feedback "has to be passed onto the ART plugin of langchain to improve the model for future iterations". The API already stores feedback and exports it as ART trajectories, but nothing consumes that export. Until something does, feedback changes nothing.

## Capabilities

- **CAP-1**
  - **intent:** The trainer pulls rated generations the API hasn't yet acknowledged, and turns each into a training scenario.
  - **success:** Given an export with 3 lines, the trainer builds 3 scenarios, each with the original system and user messages, the human reward and the user comments. A malformed line is rejected with its line number.
- **CAP-2**
  - **intent:** For each scenario, the trainer generates a group of rollouts with the trainable model.
  - **success:** For each scenario, N rollouts are produced through ART's LangGraph `init_chat_model`/`wrap_rollout`, and each is captured as an `art.Trajectory` with the scenario's system and user messages.
- **CAP-3**
  - **intent:** Each rollout is scored on output validity, whether its diagrams render in Kroki, and a RULER judgement informed by user feedback.
  - **success:** Invalid JSON or schema scores 0. A valid output with 1 of 2 diagrams rendering and a RULER score of 0.8 gets `0.5·0.5 + 0.5·0.8 = 0.65`. The RULER rubric contains the user's comments verbatim.
- **CAP-4**
  - **intent:** The trainer runs a training step on ART serverless and acknowledges the consumed trajectories only after the step succeeds.
  - **success:** When a step succeeds, one ack is sent with the pulled ids and the export's `as_of`. When a step fails, no ack is sent and the trainer exits non-zero.
- **CAP-5**
  - **intent:** The trained model can be reached through an OpenAI-compatible endpoint.
  - **success:** After a run, the trainer prints the inference base URL and model name for the latest checkpoint.
- **CAP-6**
  - **intent:** An operator can dry-run the pipeline without paying for training.
  - **success:** `--dry-run` pulls, builds scenarios, scores fixture rollouts through Kroki (RULER skipped), prints the planned groups, and makes no calls to W&B or the ack endpoint.

## Constraints

- Export data must never be lost. The ack happens only after a successful training step.
- The export lines and model output are validated strictly with Pydantic, mirroring the backend's Zod schemas. Unknown keys are rejected.
- Training runs on-policy. Groq outputs are never used as training targets.
- It's an independent folder with its own uv project, `.env` and BMAD install. Its only link to the backend is the export HTTP API.
- No paid training runs and no test runs without an explicit go-ahead from the user.

## Non-goals

- Routing backend traffic to the trained model. That's the next story.
- Hosting model weights ourselves. W&B serverless serves them.
- Scheduling (cron). The trainer runs manually in v1.

## Success signal

With one 👎 rating in the API, running `uv run uml-trainer --dry-run` prints one scenario that includes the user's comment in its rubric. A real run then performs one training step, acknowledges the trajectory (after which the export is empty), and prints an OpenAI-compatible endpoint for the trained checkpoint.

## Assumptions

- The base model is `OpenPipe/Qwen3-14B-Instruct` (the ART serverless default). The user hasn't chosen one.
- The RULER judge is Groq through LiteLLM (`groq/openai/gpt-oss-120b`), reusing the existing Groq key.

## Open Questions

- What's the cost ceiling per run (steps, rollouts per group, judge model)? The defaults are 1 step and 4 rollouts.
