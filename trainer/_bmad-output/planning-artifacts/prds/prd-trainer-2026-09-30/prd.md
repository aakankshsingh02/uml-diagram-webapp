---
title: UML ART Trainer
status: final
created: 2026-09-30
updated: 2026-09-30
spec: ../../../specs/spec-uml-art-trainer/SPEC.md
---

# PRD: UML ART Trainer

## 0. Document Purpose
This PRD is for the builder and for the BMAD runs in `trainer/`. It's an internal tool with one operator role, so the capability-spec shape applies. The reward mechanics are in the spec companion `reward-design.md`. The API contract it consumes is the backend's trajectory export (`GET /api/training/trajectories`, `POST .../ack`).

## 1. Vision
Every thumbs-down makes the next model better. The trainer closes the loop in `task.md` case 3: user feedback, then an ART (LangChain/LangGraph) RL step, then a new checkpoint served through an OpenAI-compatible endpoint.

## 2. User
- **UJ-1. Ravi runs a training pass.** Ravi, the ML engineer, first runs `uv run uml-trainer --dry-run`. He sees 3 scenarios, with the 👎 one first and its comment in the rubric. He then runs `uv run uml-trainer --steps 1`, watches the rollouts get scored, and gets a checkpoint endpoint. The next export is empty. **Edge case:** W&B returns an error partway through, the trainer exits with code 1, nothing is acked, and the next run picks up the same data.

## 3. Glossary
- **Export line** — one NDJSON trajectory from the API.
- **Scenario** — the system and user messages from an export line, plus its human reward and feedback.
- **Rollout** — one completion from the trainable model for a scenario, captured as an `art.Trajectory`.
- **Group** — the N rollouts for one scenario (an `art.TrajectoryGroup`).
- **Step** — one ART training update. It produces a checkpoint.

## 4. Features
### 4.1 Ingest
- **FR-1** Pull `limit` export lines using the bearer token. Validate each line strictly, and on a failure exit 2 with the line number. Keep the `X-Export-As-Of` value.
- **FR-2** Build scenarios from the lines, sort them by `human_reward` ascending, and cap them at `--max-scenarios` (default 8).
### 4.2 Rollout and score
- **FR-3** Produce N rollouts per scenario (`--rollouts`, default 4, minimum 2) through `art.langgraph.init_chat_model` inside `wrap_rollout`, at temperature 1.0.
- **FR-4** Apply the format gate, then the Kroki render rate, then RULER, and combine them as specified in `reward-design.md`. Record the parts in `metrics`.
- **FR-5** Leave out groups where every rollout has the same reward. If nothing is left, exit 0 with "no trainable groups", without training or acking.
### 4.3 Train and ack
- **FR-6** Train on ServerlessBackend: `TrainableModel(name, project, base_model)`, register, `backend.train(model, groups, learning_rate)`, and log the metrics.
- **FR-7** After each successful step, ack the pulled ids with `as_of`. On any error, exit 1 without acking.
- **FR-8** Print the model's inference base URL, the model name and the current step.
### 4.4 Operate
- **FR-9** `--dry-run` goes as far as scoring. Rollouts use fixtures (the exported assistant reply plus one broken variant), and there are no calls to W&B, RULER or the ack endpoint.
- **FR-10** Configuration comes from `.env`: `API_URL`, `TRAINING_API_TOKEN`, `WANDB_API_KEY`, `KROKI_URL`, `GROQ_API_KEY` (the RULER judge), `ART_PROJECT`, `ART_MODEL_NAME`, `ART_BASE_MODEL`, `RULER_JUDGE_MODEL`. It's validated at startup, and a missing required value exits 2 with its name.

## 5. Non-Goals
Routing backend traffic to the trained model (the next story), scheduling, and self-hosting weights.

## 6. MVP Scope
FR-1 to FR-10.

## 7. Success Metrics
- **SM-1:** The API's positive-rating share rises across checkpoints once traffic is routed (measured in the next story).
- **SM-2:** The render rate of rollouts rises across steps, as logged in W&B.
- **SM-C1 (counter):** Don't chase render rate by producing trivial diagrams. RULER's weight counters that.

## 8. Open Questions
1. What's the cost ceiling per run? The defaults are 1 step × 8 scenarios × 4 rollouts.
2. Is the base model OK (`OpenPipe/Qwen3-14B-Instruct`)?

## 9. Assumptions Index
- The base model and the RULER judge (`groq/openai/gpt-oss-120b`) are defaults, not your choice.
