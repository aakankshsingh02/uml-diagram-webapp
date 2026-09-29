---
title: UML Chat API
status: final
created: 2026-09-30
updated: 2026-09-30
spec: ../../../specs/spec-uml-chat-api/SPEC.md
---

# PRD: UML Chat API

## 0. Document Purpose

This PRD is for whoever builds or reviews the backend of UML Chat, and for the BMAD build, review and QA runs that consume it. It is brownfield: generation, verification, rendering and versioning already exist in `src/`, and each FR carries a delivery tag (**[BUILT]**, **[CYCLE-1]** for this BMAD cycle, **[LATER]**). The capability contract is `SPEC-uml-chat-api`; this PRD expands its capabilities into numbered FRs. Technical rationale lives in `addendum.md`. Terms follow §3 exactly.

## 1. Vision

UML Chat turns a plain-language software design into correct, rendered UML within one chat turn, and gets better the more it is used. The API is the product's engine. It turns a Prompt into verified Diagram Source, renders it, keeps every Version of a Conversation, and turns user Feedback into Trajectories an RL trainer can learn from.

The bet: **generation quality is a data problem, not a prompt problem**. Prompt tuning plateaus. Capturing exactly what the model produced, how it rendered, and how the user judged it gives the ART trainer real reward signal. Everything in v1 serves that loop: generate → verify → render → rate → export.

## 2. Target User

### 2.1 Jobs To Be Done
- **Functional:** "Give me the sequence and component views of this system so I can review the design with my team today."
- **Functional:** "When the requirements change, update the diagrams instead of starting over."
- **Contextual (trainer operator):** "Give me clean, reward-labelled trajectories without scraping application tables."

### 2.2 Key User Journeys
- **UJ-1. Asha drafts the SEBI compliance design.** Asha, a solution architect at a brokerage, pastes the SEBI circular-monitoring brief and asks for sequence and component diagrams. Within seconds she gets both, rendered. She now has a design review deck without drawing anything.
- **UJ-2. Asha folds in a new requirement.** The next day, compliance asks for email alerts on high-impact gaps. Asha adds that as a follow-up in the same Conversation. Version 2 keeps the parts of the design that still apply and adds the notification flow. **Edge case:** she asks for a Use Case diagram that wasn't in Version 1, and it's generated fresh, using Version 1 as context.
- **UJ-3. Asha flags a bad diagram.** The component diagram is missing the circular fetcher. Asha gives it a thumbs-down and writes "missing SEBI fetcher". **Edge case:** she changes her mind and gives it a thumbs-up, and the latest rating wins.
- **UJ-4. Ravi trains the next model.** Ravi, the ML engineer running ART, pulls the new Trajectories each night, trains, and acknowledges the batch. The next pull contains only newer or changed Feedback.

## 3. Glossary

- **User** — a person identified by an anonymous User Id sent by the client. Owns 0..n Conversations.
- **Conversation** — a thread of Messages about one design. Belongs to 1 User.
- **Message** — one Prompt plus the requested Diagram Types. Each Message has a Version number that counts up from 1 within its Conversation.
- **Version** — the ordinal of a Message within its Conversation.
- **Diagram Type** — one of the 14 UML 2.x ids listed in `diagram-types.md`.
- **Engine** — the Kroki renderer for a Diagram Type: `mermaid` or `plantuml` (`excalidraw` is available but no Diagram Type uses it yet).
- **Diagram** — one rendered output for one Diagram Type within a Message. It has a title, Diagram Source, SVG or Render Error.
- **Diagram Source** — the text the model generated for an Engine.
- **Render Error** — Kroki's parser message when the Diagram Source can't be rendered, even after Repair.
- **Repair** — one extra LLM call that fixes Diagram Source using the Render Error.
- **Generation** — the single LLM exchange that produced all Diagrams of a Message: model, messages, raw output, attempts, latency.
- **Rating** — +1 (thumbs up) or −1 (thumbs down).
- **Feedback** — a User's Rating and optional comment on one Diagram. At most one per User per Diagram.
- **Trajectory** — a Generation exported with its Reward in ART's format.
- **Reward** — a number in [−1, 1] derived from the Feedback and render outcomes of a Generation's Diagrams.
- **Acknowledgement** — the trainer confirming it has consumed a Trajectory.

## 4. Features

### 4.1 Diagram generation
**Description:** A User sends a Prompt and Diagram Types. With no Conversation, one is created (UJ-1). With a Conversation, the previous Version's Prompt and Diagram Sources go to the model as context (UJ-2).

#### FR-1: Generate for a new Conversation [BUILT]
A User can submit a Prompt (10–20,000 chars) and 1–14 Diagram Types with no Conversation id. Realizes UJ-1.
- Returns 201 with `conversation_id`, `version: 1`, and exactly one Diagram per requested Diagram Type, in request order.
- Unknown body keys → 400 listing the key.

#### FR-2: Update an existing Conversation [BUILT]
A User can submit a Prompt against a Conversation they own. Realizes UJ-2.
- Returns `version` = previous + 1, and the model input contains the previous Prompt and its Diagram Sources.
- A Conversation owned by another User → 404, and nothing is persisted.

#### FR-3: Normalise Diagram Types [BUILT]
- `sequential`, `use-case`, `State`, `usecase` are accepted and stored as canonical ids. Duplicates are collapsed. Unknown values → 400.

#### FR-4: Retrieve a Conversation [BUILT]
- `GET /api/conversations/:id` returns every Version with its Diagrams, in ascending order. A malformed id → 400, and an unknown id → 404.
- **[NOTE FOR PM]** There is no ownership check yet because there's no auth. See §8 Q2.

### 4.2 Verification and rendering
**Description:** The model's output is never trusted. It is schema-checked, then rendered, and repaired once if rendering fails.

#### FR-5: Validate model output [BUILT]
- The output must match the strict schema `{diagrams:[{type,title,source}]}` and cover every requested Diagram Type. If it doesn't, the validation error goes back to the model for one retry (2 attempts in total). If both attempts fail → 502 and nothing is persisted.

#### FR-6: Render with one Repair [BUILT]
- Every Diagram is rendered by its Engine. When Kroki rejects the source, exactly one Repair runs, followed by one re-render.
- If rendering still fails, the Diagram is persisted and returned with `svg: null` and a `render_error`.

#### FR-7: Record the Repair outcome [CYCLE-1]
- Each Diagram records whether it was repaired, so Trajectory metrics can count Repairs.

### 4.3 Feedback
**Description:** One click rates a Diagram (UJ-3). Changing the Rating replaces the previous one.

#### FR-8: Submit or replace Feedback [CYCLE-1]
A User can POST `{user_id, rating: 1|-1, comment?}` (comment ≤ 2,000 chars) to `/api/diagrams/:id/feedback`. Realizes UJ-3.
- Every submission returns 200 with the stored Feedback. A later submission by the same User replaces the Rating and comment and keeps the same Feedback id.
- `rating` values other than 1 and −1, and unknown keys → 400.
- Any change makes the Diagram's Generation exportable again (FR-11).

#### FR-9: Feedback ownership [CYCLE-1]
- Feedback is accepted only from the User who owns the Diagram's Conversation. Any other User, or an unknown Diagram → 404.

### 4.4 Training export
**Description:** Ravi pulls Trajectories and acknowledges them (UJ-4). The format is defined in `trajectory-export-format.md`.

#### FR-10: Capture the Generation [CYCLE-1]
- Every successful generate call persists one Generation: model, final system/user/assistant messages, attempt count, and the model call's latency in ms.

#### FR-11: Export Trajectories [CYCLE-1]
- `GET /api/training/trajectories?limit=N` returns NDJSON (at most N lines, default 100, max 1000), ordered by Generation `created_at` ascending with `id` as the tie-break. It includes only Generations that have ≥1 Feedback and haven't been Acknowledged.
- The Reward follows the formula in `trajectory-export-format.md`. For example, a single −1 Rating on one of two Diagrams gives `reward: -0.5`.

#### FR-12: Acknowledge Trajectories [CYCLE-1]
- `POST /api/training/trajectories/ack {ids:[...], as_of}` marks those Generations as exported as of the export's `X-Export-As-Of` time and returns the count. Acknowledged Generations are left out of later exports until their Feedback changes after `as_of`. Feedback changed between the pull and the ack is not lost.

#### FR-13: Protect the export [CYCLE-1]
- Both training endpoints need `Authorization: Bearer <TRAINING_API_TOKEN>`. A missing or wrong token → 401. If the token isn't configured on the server → 503.

### 4.5 Latency
#### FR-14: Parallel rendering [BUILT]
- All Diagrams of a Message are rendered and repaired concurrently.

#### FR-15: Streamed results [LATER]
- Each Diagram is sent to the client as soon as it renders (for example over SSE), so the client doesn't wait for the slowest Diagram.

#### FR-16: Per-Diagram-Type parallel generation [LATER]
- With more than 3 Diagram Types, the model is called once per type in parallel instead of once for all of them.

#### FR-17: Render cache [LATER]
- Identical (Engine, Diagram Source) pairs are served from a cache without calling Kroki.

## 5. Cross-cutting NFRs

- **Latency:** For two Diagram Types, p95 of `POST /diagrams/generate` is ≤ 15 s against Groq, and Kroki render p95 is ≤ 1 s per Diagram. [ASSUMPTION: the targets weren't given. The measured baseline is 5.4 s for 2 Diagrams.]
- **Data protection:** Prompts may contain confidential compliance posture. The training export is token-protected (FR-13), and no Prompt is logged to stdout.
- **Integrity:** Message + Diagrams + Generation are written in one transaction, so partial writes are never visible.
- **Health:** `/api/health` reports the database, Kroki and whether the model is configured, with 503 if any dependency is down.

## 6. Non-Goals

- Training models or serving checkpoints. The ART trainer is a separate Python service.
- Accounts or authentication in v1.
- Editing diagrams by hand in the API.

## 7. MVP Scope

**In:** FR-1 to FR-14.
**Out:** FR-15 to FR-17 (latency work beyond parallel rendering) and auth. See §8.

## 8. Success Metrics

- **SM-1 (primary):** First-try render success rate, meaning the share of Diagrams with an SVG and no Repair, is ≥ 85%. Validates FR-5, FR-6.
- **SM-2 (primary):** Feedback coverage, meaning the share of Generations created in a rolling 7-day window that have ≥ 1 Feedback, is ≥ 20%. Validates FR-8. Without data the trainer is idle.
- **SM-3:** Positive-rating share rises between two consecutive trainer releases. Validates FR-10 to FR-12.
- **SM-C1 (counter):** Don't optimise the Repair rate to zero by making diagrams trivial. Watch the average element count per Diagram. Counterbalances SM-1.

## 9. Open Questions

1. ART's GRPO needs several rollouts per prompt, and the product produces one per Message. Should the trainer resample or use RULER, with human Feedback as the anchor? (Owner: ML. This blocks training quality, not the export.)
2. When does auth arrive? FR-4 and FR-9 rely on a client-sent User Id, which can be spoofed.
3. Which open-weight model will ART train, and where will it be served, given that Groq can't host the LoRA?
4. What are the real latency SLOs? (See the §5 assumption.)

## 10. Assumptions Index

- §5: the latency targets are inferred, not given.
- SPEC: Ratings are binary, and the User is anonymous in v1.
