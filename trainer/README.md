# UML Chat: ART trainer

This folder turns user feedback into reinforcement-learning updates of the diagram model, using [OpenPipe ART](https://art.openpipe.ai) and its LangChain/LangGraph integration. It's an independent uv project with its own BMAD install, and its only link to the backend is the trajectory export API.

```
backend export (rated generations)
  → scenarios (system + user prompt, human reward, user comments; 👎 first)
  → N on-policy rollouts per scenario   (art.langgraph init_chat_model + wrap_rollout)
  → reward = 0 if invalid JSON/schema, else 0.5·Kroki render rate + 0.5·RULER
            (the RULER rubric includes the user's comments verbatim)
  → ServerlessBackend.train (W&B), checkpoint served via OpenAI-compatible endpoint
  → ack the pulled ids (only after a successful step)
```

The design rationale is in `_bmad-output/specs/spec-uml-art-trainer/` (the SPEC and `reward-design.md`).

## Setup

```bash
uv sync
cp .env.example .env   # TRAINING_API_TOKEN (same as backend), WANDB_API_KEY, GROQ_API_KEY
```

Needs the backend on `API_URL` and Kroki on `KROKI_URL`. Training runs on W&B serverless, so no local GPU is needed.

## Run

```bash
uv run uml-trainer --dry-run          # pull + score fixtures; no W&B, RULER or ack calls
uv run uml-trainer                    # 1 step, up to 8 scenarios × 4 rollouts (paid)
uv run uml-trainer --steps 3 --rollouts 6 --max-scenarios 16 --learning-rate 1e-5
```

Exit codes: `0` ok (including "nothing to train"), `1` runtime failure, `2` config, token or export validation error.

The ack covers only scenarios that were actually rolled out and scored in a successful step. Lines beyond `--max-scenarios`, lines whose prompt has no diagram-type listing, and groups the judge failed on stay in the export for the next run. If a later step fails after an earlier one trained, exit 1 says how many ids were already acked.

A real run prints the checkpoint's inference base URL and model name. Routing the backend to that model is the next story.

## Tests

```bash
uv run pytest     # everything stubbed: API, Kroki, W&B, RULER
uv run ruff check
```
