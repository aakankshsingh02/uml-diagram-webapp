---
title: 'ART trainer pipeline: export → on-policy rollouts → scored groups → serverless train → ack'
type: 'feature'
created: '2026-09-30'
status: 'in-review'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-uml-art-trainer/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-uml-art-trainer/reward-design.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-trainer-2026-09-30/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The API exports rated generations as ART trajectories, but nothing trains on them, so user feedback never improves the model (task.md case 3, PRD FR-1 to FR-10).

**Approach:** A `uml-trainer` CLI (uv project):
- pulls the export and builds scenarios from it;
- generates N on-policy rollouts per scenario through `art.langgraph` (`init_chat_model` + `wrap_rollout`);
- scores them with the format gate, Kroki render rate and a feedback-informed RULER judgement;
- trains a `TrainableModel` on `ServerlessBackend`;
- acks the pulled ids only after a successful step.

`--dry-run` stops before any paid call.

## Boundaries & Constraints

**Always:**
- Validate the export and the model output with strict Pydantic (`extra="forbid"`).
- Ack only after a successful step.
- A Kroki transport error aborts the run, and is never scored.
- Config comes from `.env`, validated at startup.
- Exit codes: 0 for ok, 1 for a runtime failure, 2 for config or validation errors.

**Never:**
- Use the exported Groq reply as a training target.
- Call W&B, RULER or ack in `--dry-run`.
- Run tests or paid training without the user's go-ahead.
- Import from `backend/`.

**Decisions (auto-resolved, user said "start"):**
- ART 0.5.20 needs `TrainableModel(run_name=...)`, so the default is `ART_RUN_NAME=main` to keep checkpoints on one run.
- The pulled export is used for every `--steps` iteration, and it's acked after the first successful step.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Empty export | 0 lines | "nothing to train", exit 0, no ack | N/A |
| Malformed line | line 2 has an unknown key | exit 2, message names line 2 | nothing trained or acked |
| Scenario order | rewards −0.5, 1, 0 | scenarios ordered −0.5, 0, 1; capped at `--max-scenarios` | N/A |
| Rubric | feedback 👎 "missing fetcher" on component | the rubric contains `component` and the comment verbatim | N/A |
| Invalid rollout | the reply isn't valid JSON or the schema, or a requested type is missing | reward 0, `format_ok=0` | N/A |
| Scored rollout | valid, 1 of 2 render, RULER 0.8 | reward 0.65 | N/A |
| Kroki down | transport error while rendering | the run aborts with exit 1, no ack | never scored as a failure |
| Flat group | every reward equal | left out of training | N/A |
| Nothing trainable | every group flat | exit 0, no train, no ack | N/A |
| Train ok | step succeeds | one ack with every pulled id and `as_of`; prints the endpoint, model name and step | N/A |
| Train fails | `backend.train` raises | exit 1, no ack | N/A |
| Dry run | lines present | prints the scenarios and fixture scores; zero W&B, RULER or ack calls | N/A |
| Missing config | `WANDB_API_KEY` unset on a real run | exit 2 naming it | dry run doesn't need it |

</frozen-after-approval>

## Code Map

- `pyproject.toml` — script `uml-trainer = "uml_trainer.cli:main"`, pytest config (asyncio auto mode).
- `src/uml_trainer/config.py` — `Settings` (pydantic-settings, `.env`); `require_for_training()`.
- `src/uml_trainer/schemas.py` — strict `ExportLine` (mirrors the backend's `trajectory-export-format.md`), `LlmDiagrams`, `ENGINE_BY_TYPE` (mirrors the backend's `diagram.schema.ts`).
- `src/uml_trainer/export_client.py` — `pull(limit)` gives `(as_of, lines)`, with line-numbered validation errors; `ack(ids, as_of)`.
- `src/uml_trainer/scenarios.py` — `Scenario`, `build_scenarios`, `build_rubric`, parsing requested types from the user message (`- <type>: engine=`).
- `src/uml_trainer/scoring.py` — `format_gate`, `KrokiRenderer` (raises `RendererUnavailable` on transport or 5xx), `render_rate`, `combine`, `is_trainable`.
- `src/uml_trainer/rollout.py` — `UmlTrajectory(art.Trajectory)` with `reply`; `rollout(model, scenario)` via `init_chat_model`.
- `src/uml_trainer/pipeline.py` — `score_group` (format, render, RULER, combine) and the `run()` orchestration.
- `src/uml_trainer/cli.py` — argparse (`--dry-run`, `--steps`, `--rollouts`, `--max-scenarios`, `--limit`, `--learning-rate`), exit codes.
- `tests/` — pytest with respx fixtures covering the matrix.
- `.env.example`, `.gitignore`, `README.md`.

## Tasks & Acceptance

**Execution:**
- [x] `src/uml_trainer/{config,schemas,export_client}.py` — ingest (FR-1, FR-10)
- [x] `src/uml_trainer/scenarios.py` — scenarios and rubric (FR-2, FR-4)
- [x] `src/uml_trainer/{scoring,rollout}.py` — rollouts and rewards (FR-3, FR-4, FR-5)
- [x] `src/uml_trainer/{pipeline,cli}.py` — training, ack, output, dry run (FR-6 to FR-9)
- [x] `tests/*` — a test for every matrix row (**written; run only when the user asks**)
- [x] `.env.example`, `README.md`, `pyproject.toml`

**Acceptance Criteria:**
- Given the code, when `uv run ruff check` and `uv run python -m compileall src` run, then both are clean. These are static checks, not tests.

## Implementation Notes

- Read ART 0.5.20's installed source instead of trusting the docs. `TrainableModel` requires `run_name` (not in the docs); `init_chat_model` accepts provider `None`; `wrap_rollout` rebuilds `messages_and_choices` from LangChain logs and **swallows conversion errors** (a rollout could silently train on empty messages; see review).
- RULER key: LiteLLM reads provider keys from `os.environ`, and pydantic-settings doesn't export `.env`, so the Groq key goes in through `extra_litellm_params`.
- The format gate tolerates one `<think>` block and one ```json fence. The backend must apply the same leniency when it serves this model (next story).
- `trainer/.env` was created with TRAINING_API_TOKEN, WANDB_API_KEY and GROQ_API_KEY copied from `backend/.env` (gitignored; values never printed).
- Static checks only: ruff clean, compileall ok, and modules import. **Tests are written but not run** (user preference).

## Spec Change Log

## Review Triage Log

## Verification

**Commands (run only on the user's request):**
- `uv run pytest` — expected: every test passes
- `uv run uml-trainer --dry-run` — expected: scenarios printed, no paid calls
