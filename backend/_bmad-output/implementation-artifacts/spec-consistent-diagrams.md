---
title: 'Consistent diagrams from a shared architecture model'
type: 'bugfix'
created: '2026-09-30'
status: 'done'
baseline_commit: 'f502a43'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-backend-2026-09-30/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The diagrams in one generation contradict each other. In conversation a48aa8e1:
- The sequence diagram has 8 participants, including an invented `System`.
- The component diagram has 14 components. Data such as `RawCirculars`/`ClauseTable` is modelled as components, plus `NotificationService` and `ExistingComplianceDB`, which the sequence diagram lacks.

The follow-up "Can you make sure both the diagrams are consistent" (v4) returned byte-identical sources to v3, because the update prompt lets the model echo the previous diagrams.

**Approach:**
1. Generate a strict **architecture model** first: named elements (actor, service, datastore, external) and their interactions. Store it per message version, and on an update, revise the previous version's model.
2. Generate every diagram from that model using its exact element names.
3. Check the names programmatically, and feed any mismatch back through the existing retry loop.
4. Treat diagrams that are unchanged on an update as a mismatch too.

## Boundaries & Constraints

**Always:**
- Validate the architecture model with strict Zod:
  - element names are unique identifiers (`^[A-Za-z][A-Za-z0-9_]{0,59}$`);
  - interactions reference known elements;
  - every element takes part in at least one interaction.
- For sequence, communication, component and deployment diagrams, the set of names extracted from the source must equal the set of model element names (compared case-insensitively, ignoring punctuation).
- Data (documents, tables, reports) appears only as message or edge labels.
- Keep the controller → service → repository layering.

**Never:**
- Change the response shape of `POST /diagrams/generate` or `GET /conversations/:id` (the frontend validates with strict Zod).
- Fail a generation only because it's still inconsistent after the retries. The final attempt is accepted, and the issues are logged in the trace metrics.
- Run tests (the user's preference). They're written only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Consistent first try | model {A,B,Store}; sequence and component use exactly those | 1 diagram call, no feedback | N/A |
| Extra name | the component adds `ClauseTable` | feedback lists "ClauseTable is not in the architecture model", then a retry | the final attempt is accepted |
| Missing name | the sequence omits `Store` | feedback lists "missing Store", then a retry | same |
| Aliased participant | `participant F as Fetcher` where F isn't in the model but the label is | accepted (the label matches) | N/A |
| Types not checked | class or state diagram | no name check (prompt rules only) | N/A |
| Unchanged update | every source equals the previous version's | feedback: "identical to the previous version; apply the requested change" | the final attempt is accepted |
| Invalid model | an interaction references an unknown element, or an element has no interaction | Zod feedback retry | 502 after 2 attempts (as today) |
| Update | a previous version exists with an `architecture` | the model call receives the previous model plus the new request | a legacy version without a model starts fresh |
| Stored | any successful generation | `messages.architecture` holds the model JSON | N/A |

</frozen-after-approval>

## Code Map

- `migrations/004_message_architecture.sql` — `ALTER TABLE messages ADD COLUMN architecture JSONB` (nullable for legacy rows).
- `src/schemas/architecture.schema.ts` — new `ArchitectureModelSchema` (strict, refined), with its types.
- `src/services/consistency.ts` — new, pure: `extractNames(type, source)` (Mermaid sequence participants/actors and message endpoints, plus aliases and labels; PlantUML `[X]`, keyword elements with `as` aliases, and arrow endpoints) and `checkConsistency(diagrams, model, previous?)`, which returns issue strings.
- `src/services/llm.service.ts` — `designArchitecture(prompt, previous?)`; `generateDiagrams(prompt, types, architecture, previous?)` gets model-driven prompts; `completeJson` accepts an optional soft `check` whose issues are fed back like validation errors, with a third attempt allowed for soft issues and the last attempt accepted with its issues. The update prompt no longer says "keep what still applies" about the diagrams.
- `src/services/diagram.service.ts` — call `designArchitecture`, then `generateDiagrams`; pass the previous architecture; store it through `addMessage`.
- `src/repositories/conversation.repository.ts` — `Message.architecture`; `addMessage(…, architecture)`.
- `tests/helpers.ts` — `fakeLlm` implements `designArchitecture`.
- `tests/unit/consistency.test.ts`, `tests/unit/llm.service.test.ts` — the matrix rows. `tests/api/diagrams-conversations.test.ts` — update the context-assertion argument positions.
- Reuse: `HttpError`, the existing retry loop, `withTransaction`.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/004_message_architecture.sql` — the column
- [x] `src/schemas/architecture.schema.ts` — the model schema
- [x] `src/services/consistency.ts` — name extraction and the check
- [x] `src/services/llm.service.ts` — the architecture call, model-driven generation, soft-check retries
- [x] `src/services/diagram.service.ts`, `src/repositories/conversation.repository.ts` — wiring and persistence
- [x] `tests/**` — the matrix (written, not run)

**Acceptance Criteria:**
- Given the code, when `npm run typecheck` runs (static, allowed), then it passes.

## Implementation Notes

- Two-step generation: `designArchitecture` (strict model, retries on Zod issues) → `generateDiagrams` from the model. Update prompts no longer include the previous diagrams, which removes the echo path (v3 → v4 was byte-identical).
- `completeJson` soft checks: consistency issues are fed back with a check-specific header. Schema failures keep the 2-call budget, and consistency feedback gets one extra call (3 in total). The last schema-valid reply is accepted with its issues, and `attempts` counts every call made.
- After a render repair, names are re-checked, because a repair can rename elements. Remaining issues go to `generations.consistency_issues` and a warning log with the conversation id and version.
- A stored `messages.architecture` is re-validated before reuse; if invalid it falls back to the legacy path (previous diagrams as context).
- Element names are letters and digits only, so case-insensitive uniqueness matches the checker's normalisation.
- Migration 004 was applied to the dev DB, because the hot-reloading dev server already wrote the new column.
- Sanity check (not a test run): the checker on the real conversation a48aa8e1 v3 reports data modelled as components (`RawCirculars`, `ClauseTable`, …), the extra `NotificationService`/`ExistingComplianceDB`, the missing `System`, and the unchanged echo.
- Tests are written but not run, per the user's preference. Typecheck (src + tests) is clean.

## Spec Change Log

- **Deviation, awaiting the human.** The frozen intent lists deployment diagrams among the name-checked types. The implementation checks sequence, communication and component only, because deployment nodes (servers, containers, runtimes) are legitimately extra and strict equality would force false feedback. Deployment keeps the prompt rules. Options: (a) accept the exclusion; (b) check only that the non-node elements of a deployment are model elements.

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap; run in parallel, context-free).

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Schema lowercases for duplicates, checker strips `_` → names collide | medium | patch | Names are letters and digits only |
| 2 | Arrow styles `-[hidden]->` and bracketed label text read as elements | medium | patch | Styles stripped with lookahead; label text after ` : ` ignored |
| 3 | Interfaces in arrows flagged despite "ports aren't elements" | medium | patch | Interface names collected and excluded |
| 4 | Multi-line note/legend bodies parsed | medium | patch | Block tracking (`end note`, `endlegend`) |
| 5 | `component [X] as CF`, `participant L as "Long Name"` aliases lost or swapped | medium | patch | Declaration regex handles bracket and quoted aliases |
| 6 | Case-insensitive skip drops elements named Node, End, … | medium | patch | Keyword skip is case-sensitive |
| 7 | Zero names recognised → "everything missing" | low | patch | A dedicated issue |
| 8 | Repair can rename elements after the check | medium | patch | Re-check after repair; issues merged |
| 9 | `attempts` under-counted on fallback | low | patch | Counts calls made |
| 10 | Schema failures got 3 calls | medium | patch | Separate budgets |
| 11 | Feedback header wrong for the "identical" issue | low | patch | Header supplied by the check |
| 12 | Stored architecture not validated | low | patch | `safeParse`, falls back to legacy |
| 13 | Latency excludes the architecture call | low | patch | Added to `trace.latencyMs` |
| 14 | `console.warn` lacks ids | low | patch | Logs conversation and version after the transaction |
| 15 | Missing tests (issues persisted, fallback, legacy null model, architecture 502, parser cases) | medium | patch | Added (not run) |
| 16 | Deployment excluded vs frozen intent | — | intent deviation | Surfaced to the human (see Spec Change Log) |
| 17 | `consistency_issues` not in the trainer export; architecture exchange not recorded as training data | medium | defer | Needs the trainer's strict export schema to change |
| 18 | Unchanged check compares against post-repair sources | low | reject | Needs a previously repaired diagram to be echoed; rare, and v3 → v4 wasn't repaired |

## Verification

**Commands (run only when the user asks):**
- `npm test` — expected: all pass
- `npm run db:migrate` — expected: applies 004
