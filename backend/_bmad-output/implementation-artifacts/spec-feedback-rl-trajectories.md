---
title: 'Feedback capture and ART trajectory export'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/specs/spec-uml-chat-api/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-uml-chat-api/trajectory-export-format.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users can't rate diagrams, and the API doesn't keep the model exchange that produced them. That leaves the ART trainer with no reward-labelled data (PRD FR-7 to FR-13, task case 3).

**Approach:**
- Persist one Generation per message: the final system, user and assistant messages, the attempt count and the latency, plus a per-diagram `repaired` flag.
- Add an owner-only feedback upsert.
- Expose token-protected NDJSON export and ack endpoints that return rated Generations as ART Trajectories with a computed Reward.

## Boundaries & Constraints

**Always:**
- Keep the controller → service → repository layering.
- Validate every request body, param and query with strict Zod.
- Write the Generation in the same transaction as the Message and its Diagrams.
- The Reward formula and line shape follow `trajectory-export-format.md` exactly.
- Compare tokens in constant time.

**Never:**
- Log prompts.
- Mark data exported on read.
- Accept feedback from a user who isn't the Conversation owner.
- Add an ORM or new runtime dependencies.
- Change the response shape of `POST /diagrams/generate`.

**Decisions (auto-resolved at the checkpoint, approved by the user):**
- Feedback upsert always returns 200 `{id, diagram_id, rating, comment}`.
- Exportable = `exported_at IS NULL OR` the latest feedback `updated_at > exported_at`.
- The export returns `X-Export-As-Of` (the DB time of the export query). The ack requires `{ids, as_of}` and sets `exported_at = as_of`, so feedback changed after the pull is exported again.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First rating | owner, rating −1 | 200, row stored | N/A |
| Re-rate | same owner, rating +1 | 200, same id, rating replaced, `updated_at` bumped | N/A |
| Foreign user | other user_id | 404 | nothing written |
| Bad rating | rating 0 or "up" | 400 | Zod details |
| Export, none rated | unrated generations only | 200, empty body | N/A |
| Export, one of two rated −1 | — | 1 line, `reward: -0.5` | N/A |
| Render failed, rated +1 | svg null | that diagram scores −1 | N/A |
| Ack then re-rate | ack with as_of, then new rating | exportable again | N/A |
| Missing/wrong token | — | 401 | constant-time compare |
| Token unset on server | — | 503 | N/A |

</frozen-after-approval>

## Code Map

- `migrations/002_generations_feedback.sql` — new. Adds `diagrams.repaired`, a `generations` table (message_id unique, messages jsonb, attempts, latency_ms, exported_at), feedback unique(diagram_id, user_id) and `updated_at`, and drops the unused `feedback.exported_at` and its index.
- `src/services/llm.service.ts` — `completeJson` also returns `content`, `attempts` and `latencyMs`. `generateDiagrams` returns `{diagrams, trace}`. Repair is unchanged.
- `src/services/diagram.service.ts` — `renderWithRepair` sets `repaired`. The transaction also inserts the Generation. The returned DTO is unchanged.
- `src/repositories/diagram.repository.ts` — insert `repaired`, and add `findOwner(diagramId)` (a join to conversations and users).
- `src/repositories/feedback.repository.ts` — new: `upsert`.
- `src/repositories/generation.repository.ts` — new: `insert`, `listExportable(limit)` (returns `as_of` plus rows with aggregated diagrams and feedback), `acknowledge(ids, asOf)`.
- `src/services/feedback.service.ts`, `src/services/training.service.ts` — new. `toTrajectory(row)` is a pure function that computes the Reward and metrics.
- `src/controllers/feedback.controller.ts`, `src/controllers/training.controller.ts` — new.
- `src/middlewares/require-bearer.ts` — new token guard.
- `src/schemas/feedback.schema.ts`, `src/schemas/training.schema.ts` — new strict schemas.
- `src/config/env.ts`, `.env.example`, `src/container.ts`, `src/routes/index.ts` — wire in `TRAINING_API_TOKEN` and the new routes.
- Reuse: `HttpError`, `withTransaction`, `validateBody`, and the default-`db` repository parameter pattern.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/002_generations_feedback.sql` — schema changes — the tables that FR-7 to FR-12 need
- [x] `src/services/llm.service.ts` — return the trace — FR-10
- [x] `src/repositories/*` — generation/feedback repositories and diagram changes — keep SQL in repositories
- [x] `src/services/{diagram,feedback,training}.service.ts` — the logic
- [x] `src/schemas/*`, `src/middlewares/require-bearer.ts`, `src/controllers/*`, `src/routes/index.ts`, `src/container.ts`, `src/config/env.ts`, `.env.example` — the HTTP surface
- [ ] unit tests for `toTrajectory` covering the I/O matrix reward rows (the QA phase adds the test runner)

**Acceptance Criteria:**
- Given a successful generate, when the DB is queried, then exactly one `generations` row exists for the message, holding 3 messages (system, user, assistant).
- Given a rated generation that was exported and acked with `as_of`, when the export runs again with no feedback change, then it's absent.
- Given the checks, when `npm run typecheck` and `npm run build` run, then both succeed.

## Implementation Notes

- Implemented inline (subagent-free implementation per session policy); diff vs baseline snapshot: 29 files, +943/−91.
- Migration 002 also adds `diagrams.position`: rows of one UNNEST insert share `created_at`, so the old `ORDER BY created_at` returned diagrams in random UUID order (pre-existing bug surfaced while building the export's diagram aggregation).
- `as_of` uses `statement_timestamp()` (constant per statement) rather than `clock_timestamp()` (per row). Known residual race: a feedback upsert whose transaction starts before the export statement but commits after its snapshot gets `updated_at < as_of` and would be acked without being exported. Window is one single-statement autocommit (~ms).
- Test seams: `createContainer({llm, kroki, trainingToken})`, `DiagramLlm`/`DiagramRenderer` Pick types; `runMigrations` extracted from the CLI for the test global setup.
- Tests: vitest + supertest against `uml_diagrams_test` (created on demand), 24 passing; mutation check (render-failure score, ack as_of) turned 4 tests red.
- Live verification against Groq/Kroki: generate → −1 → export (reward −0.5, 3 messages, attempts=2) → ack → empty → re-rate → exported (0.5) → 401 without token.

## Spec Change Log

- **Loop 1 (intent_gap, auto-resolved under the user-approved run-through).** Trigger: blind-hunter found that a +1 on a diagram that only rendered after Repair rewards the model's broken original output, because the trajectory holds the pre-repair completion. Amended: the Reward rule in the companion `trajectory-export-format.md` now scores repaired diagrams −1 (the frozen block's "follow trajectory-export-format.md exactly" still holds). Known-bad state avoided: a policy reinforced toward invalid syntax. KEEP: generation capture, owner-only upsert, pull + ack with `as_of`, NDJSON line shape, `position` ordering, test seams (`createContainer` overrides, fake LLM/Kroki).
- **Concurrent change (session backend-31, not this build).** Email/password bearer auth landed mid-review. `user_id` was removed from every body and ownership now comes from `req.user`. This build's feedback/training code and tests were adapted by backend-31 and re-verified here.

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap; run in parallel, context-free).

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | +1 on a repaired diagram rewards the broken original output | high | intent_gap → loop 1 | Trajectory `messages_and_choices` holds the pre-repair completion; fixed in `diagramScore` + companion |
| 2 | Pull/ack race: feedback in flight during export gets acked unexported | low | patch (partial) + defer | `updated_at` is now `clock_timestamp()` (write time, not tx start); the residual sub-ms window needs a monotonic watermark (deferred) |
| 3 | `as_of` truncated to ms via JS Date → duplicate re-exports | low | patch | `as_of` rendered by SQL `to_char(... .US)` and kept as a string through Zod to `$2::timestamptz`; test asserts 6 fractional digits |
| 4 | Stale/replayed ack moves watermark back; future `as_of` hides feedback | medium | patch | `GREATEST(COALESCE(exported_at,'-infinity'), LEAST($2, statement_timestamp()))`; test added |
| 5 | Pre-migration diagrams all `position=0` → unstable order | low | patch | `ORDER BY position, created_at, id` |
| 6 | Bearer scheme case-sensitive | low | patch | Case-insensitive regex; test with `bearer` |
| 7 | `comment: null` rejected | low | patch | `.nullish()` |
| 8 | `resetDb` would truncate any DB it's pointed at | medium | patch | `_test` suffix guard in `resetDb` and global setup |
| 9 | `repaired` never verified end to end | medium | patch | API test with BROKEN→FIXED repair asserts the DB flag and `metrics.repaired` |
| 10 | Real `LlmService` trace untested | medium | patch | Optional injected Groq client; unit test: invalid then valid reply → attempts 2, 3 messages, second reply kept |
| 11 | `position` ordering untested with >1 diagram | medium | patch | Test covers conversation GET and export feedback order |
| 12 | Unused `engineOf` helper; no docs for tests/export/token | low | patch | Helper removed; README sections and `TEST_DATABASE_URL` example added |
| 13 | Migration 002 aborts on duplicate or neutral feedback rows | false | reject | No endpoint wrote feedback before this change, so the table was empty everywhere |
| 14 | Export duplicates diagrams when several users rate one | false | reject | Only the owner can rate (FeedbackService), and unique(diagram_id, user_id) holds |
| 15 | Feedback on pre-migration diagrams never exports (no generation row) | low | defer | Only affects dev data created before 002 |
| 16 | Export CTE scans all feedback each pull; lost partial index | low | defer | Negligible at current volume; add `feedback(updated_at)` index when it matters |
| 17 | Client-supplied `user_id` lets anyone poison training data | high | resolved elsewhere | Superseded by backend-31's session auth; feedback ownership now uses `req.user` |
| 18 | GRPO groups of size 1 carry no learning signal | medium | defer | SPEC open question; trainer must resample or use RULER |
| 19 | No GET/DELETE for a user's own feedback; UI can't restore state | medium | defer | Belongs to the history story |
| 20 | Global setup misses edited migrations; URL options dropped | low | reject | Dev-only inconvenience; the fix adds complexity |

Post-patch: typecheck (src + tests) and build are clean; 53/53 tests pass, including backend-31's auth suite.

Pass 2 (loop 1; same three layers over the full diff, which now includes backend-31's auth work).

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| L1 | Migration 002 aborts on legacy feedback | carried false | reject | Same as #13 |
| L2 | Watermark race (write before snapshot, commit after) | carried low | defer | Same as #2; monotonic revision in deferred-work |
| L3 | Re-rate "bumped" assertion vacuous after the clock_timestamp change | medium | patch | Test now compares `updated_at` before and after the second POST |
| L4 | `repaired` not pinned when a repair runs and fails | medium | patch | UNFIXABLE test asserts `metrics.repaired: 0` and DB `repaired=false` |
| L5 | Transient Kroki failure triggers an LLM "repair" and poisons the reward | medium | patch | `RenderResult.retryable` (network, timeout, 5xx) → retry once and never repair; test + mutation check |
| L6 | Strict trajectory query rejects extra params | false | reject | Intended: the spec requires strict Zod on every query |
| L7 | `TRAINING_API_TOKEN` accepts weak values | low | patch | Boot rejects values shorter than 32 characters |
| L8 | Duplicate bearer regex | low | patch | `requireBearer` reuses `bearerToken()` |
| L9 | README scripts/test docs stale | low | patch | Scripts table and TEST_DATABASE_URL note updated |
| L10 | `.env.example` implies vitest reads `TEST_DATABASE_URL` from `.env` | low | patch | Comment now says to export it in the shell |
| L11 | CRLF whole-file rewrites | carried false | reject | No CR bytes in the tree |
| L12 | GRPO singleton groups; viewer ratings missing from the conversation payload | carried | defer | Same as #18 and #19 |
| A1–A8 | Auth code (backend-31): no rate limit before scrypt or paid Groq calls; stored scrypt params unbounded or NaN → 500; no rehash; cached rejected dummyHash; no password reset/logout-all/purge; signup 409 enumerates emails; unbounded SESSION_TTL_DAYS; conversation list unpaginated; vacuous token-hash and TTL tests | — | not this story | Outside this build's intent; handed to the backend-31 owner and listed in the final report |

Post-patch: typecheck and build are clean; 54/54 tests pass; the L5 mutation check turned 1 test red.

## Verification

**Commands:**
- `npm run typecheck && npm run build` — expected: exit 0
- `npm run db:migrate` — expected: "applied 002_generations_feedback.sql"
- a curl script: generate, feedback −1, export (1 line, reward −0.5), ack, export (empty), re-rate, export (1 line) — expected as stated
