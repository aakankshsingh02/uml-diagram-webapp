---
id: SPEC-uml-chat-api
companions:
  - diagram-types.md
  - trajectory-export-format.md
sources:
  - ../../../../task.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# UML Chat API

## Why

A vision plus a mandate. The vision: engineers describe a software design in plain language and get correct UML back in seconds. The mandate: the brief requires the model to improve from user feedback through LangChain's ART (Agent Reinforcement Trainer) integration. The API is where generation, verification, versioning and feedback capture meet, so it owns the data the trainer learns from.

## Capabilities

- **CAP-1**
  - **intent:** A new user sends a prompt and a list of diagram types, and receives one rendered diagram per requested type.
  - **success:** A POST with the SEBI prompt and `["sequential","component"]` returns 201 with 2 diagrams, each with non-null `svg`, plus a new `conversation_id` at `version: 1`.
- **CAP-2**
  - **intent:** An existing user sends an updated prompt on a conversation and receives updated diagrams. The previous version is used as context.
  - **success:** A second POST with the same `conversation_id` returns `version: 2`, and the model input contains the version-1 prompt and diagram sources. Another user id gets 404.
- **CAP-3**
  - **intent:** A signed-in user rates a generated diagram (thumbs up or down, optional comment). The rating is stored against the exact generation that produced the diagram.
  - **success:** A rating persists and returns 200, a second rating by the same user replaces the first and keeps the same id, a rating on another user's diagram returns 404, and an invalid rating returns 400.
- **CAP-4**
  - **intent:** The ART trainer pulls generations that have feedback, as trajectories in the format of `trajectory-export-format.md`, and acknowledges them so they aren't served again.
  - **success:** After a thumbs-down, the next export contains that generation with `reward < 0`. After it's acknowledged, it's absent from the next export. Changing the feedback makes it exportable again. A call without the secret returns 401.
- **CAP-5**
  - **intent:** Generated diagram code is syntax-checked before it reaches the user. Failures are repaired automatically or reported.
  - **success:** An LLM response that fails the schema is retried with the validation error. A Kroki render error triggers one repair attempt. If the repair also fails, the diagram is returned with `render_error` and its source.
- **CAP-6**
  - **intent:** Diagrams are rendered to SVG on the server so the UI only has to display them.
  - **success:** Every successful diagram response includes an SVG produced by the self-hosted Kroki.
- **CAP-7**
  - **intent:** End-to-end latency is kept low and measured.
  - **success:** Diagrams in one generation are rendered in parallel, and the time the model call takes is recorded for every generation.
- **CAP-8**
  - **intent:** All 14 UML 2.x diagram types can be requested, and loose type names are normalised.
  - **success:** Each id in `diagram-types.md` is accepted, and `"sequential"`, `"use-case"` and `"State"` map to their canonical ids.

## Constraints

- LLM output is untrusted. It must pass strict Zod validation (unknown keys rejected) before it is rendered or persisted.
- Rendering uses the self-hosted Kroki only (Mermaid, PlantUML, Excalidraw). No third-party rendering service.
- Groq is the model provider. ART trains open-weight LoRA checkpoints, which Groq can't serve, so deploying the trained model is outside this API.
- The training export exposes every user prompt, so it requires a server-side secret. It is never available with only a client-supplied id.
- The backend follows the controller → service → repository layering and runs without the frontend.

## Non-goals

- Running RL training or hosting model checkpoints. The ART trainer is a separate Python service that consumes the export.
- Editing diagrams by hand in the API. Changes are made through prompts only.

## Success signal

On a clean database: send the SEBI prompt, send one follow-up, and give one diagram a thumbs-down. The export endpoint then returns exactly the rated generation as a trajectory with a negative reward and the full system, user and assistant messages. After it is acknowledged, the export returns nothing.

## Assumptions

- Users sign in with email and password (bearer sessions, added by the backend-31 session). Ownership checks use the session user, never the request body.
- Ratings are binary (+1 / −1) with an optional comment. Neutral ratings aren't collected.

## Open Questions

- ART's GRPO training needs more than one rollout per prompt to learn anything, and single human-rated rollouts don't provide that. Should the trainer resample extra rollouts, or use RULER (ART's LLM-judge reward) with the human rating as an anchor?
- Which open-weight model will ART train, and where will the resulting LoRA be served?
- What are the latency targets (p50/p95)? `task.md` doesn't say.
