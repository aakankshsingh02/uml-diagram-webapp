---
title: 'Project sequence, communication and component diagrams from the architecture model'
type: 'feature'
created: '2026-09-30'
status: 'in-progress'
baseline_commit: '6661c87'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sequence, communication and component diagrams are still written by the LLM from the architecture model. A regex name check catches drift after the fact, but it can't guarantee that two views show the same elements, it retries (latency and tokens), and it can misparse legitimate syntax.

**Approach:** These three views are drawn by deterministic code (projectors) from the stored architecture model, so every element appears with the same name in every view by construction. The LLM draws only the other diagram types. The architecture call is recorded as its own RL trace, and the export can be filtered by trace kind so that each call is rewarded only for what it produced.

## Boundaries & Constraints

**Always:**
- The projected types are `sequence` (Mermaid), `communication` (PlantUML) and `component` (PlantUML). Every model element appears exactly once in each view, in model order. Every interaction appears, in model order.
- **Sequence:** `actor` for actors and `participant` otherwise; one `->>` message per interaction.
- **Component:**
  - `actor` for actors, `database` for datastores, `component` for services, and `component` with an `<<external>>` stereotype for externals;
  - one arrow per unique (from, to) pair, labelled with that pair's messages.
- **Communication:** the same nodes. Links carry numbered messages (`1: …`) in interaction order, with one link per unique pair.
- Message text is sanitised per engine: line breaks, statement separators and comment markers are removed, and labels are truncated. An element name that is an engine keyword is aliased behind a prefix that `ELEMENT_NAME` can never produce, so the id can't collide with another element's name.
- Projected diagrams are never sent to LLM syntax repair; transient Kroki failures are still retried once.
- The response shapes of `POST /diagrams/generate` and the conversation endpoints are unchanged. The shape of an NDJSON export line is unchanged too: the trainer's schema forbids extra keys.
- `GET /training/trajectories?kind=diagrams|architecture` defaults to `diagrams`.
  - **`diagrams`:** a line lists, scores and becomes exportable only through feedback on LLM-drawn (non-projected) diagrams.
  - **`architecture`:** scored over all of the message's diagrams as `rating ?? 0`, with no render or repair penalty.
- Each trace has its own latency.

**Never:**
- LLM-written sources for the projected types.
- Changes to `trainer/` or `frontend/`.
- Removing the unchanged-on-update check for LLM-drawn types.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Only projected types | `["sequence","component"]` | 1 architecture call and 0 diagram calls. Both views list identical elements. One `generations` row with kind `architecture`. | N/A |
| Mixed | `["sequence","class"]` | The diagram call is made for `class` only. The response keeps the requested order. Two `generations` rows. | N/A |
| Keyword element | element named `End` or `Node` | Aliased id in the source; the label is still `End`. | N/A |
| Message with `;` / `#` / a newline | `"save; notify\n#1"` | A single-line label that renders. | N/A |
| Projected render fails | Kroki 400 | `render_error` set, `repaired` false, no repair call. | Kept, not thrown |
| Feedback only on a projected diagram | A rating on sequence in a mixed message | Exported under `kind=architecture`, not under `kind=diagrams`. | N/A |

</frozen-after-approval>

## Code Map

- `src/schemas/architecture.schema.ts` -- `ArchitectureModel`, `ELEMENT_NAME` (letters and digits only). Reuse as-is.
- `src/services/consistency.ts` -- Reduce to the unchanged-on-update check: delete `extractNames`, `nameIssues` and `CHECKED_TYPES`.
- `src/services/llm.service.ts`
  - `designArchitecture` returns `{architecture, trace}`. Its trace is built like `generateDiagrams`' trace, with `issues: []`.
  - `generateDiagrams` is unchanged apart from the check. `VIEW_RULES`: drop the sequence/component lines and keep the "names only" rule.
  - `DiagramLlm` stays.
- `src/services/diagram.service.ts`
  - Orchestrates the projected and LLM-drawn diagrams and merges them in requested order.
  - `renderWithRepair` takes a `projected` flag. Remove the post-repair `nameIssues` merge and the `latencyMs +=` line.
  - Insert each trace with its kind.
- `src/repositories/diagram.repository.ts` -- `projected` on `Diagram`/`NewDiagram`, plus a 9th UNNEST column.
- `src/repositories/generation.repository.ts`
  - `insert(messageId, trace, kind, db)`.
  - `listExportable(limit, kind)`: filter `g.kind`. For `diagrams`, the `latest` CTE and the `diagrams` aggregate exclude projected diagrams.
  - Add `projected` to `ExportDiagram`.
- `src/services/training.service.ts` -- `toTrajectory(g, kind)`: `architecture` scores `rating ?? 0`; `diagrams` keeps `diagramScore`.
- `src/schemas/training.schema.ts`, `src/controllers/training.controller.ts` -- the `kind` query param.
- `migrations/005_projected_diagrams.sql` -- new migration.
- Tests:
  - `tests/helpers.ts` -- the fake `designArchitecture` returns `{architecture, trace}`.
  - `tests/unit/consistency.test.ts`, `tests/unit/llm.service.test.ts`, `tests/unit/trajectory.test.ts`.
  - `tests/api/*.test.ts` -- sequence/component now come from projection, not the fake LLM.

## Tasks & Acceptance

**Execution:**
- [ ] `migrations/005_projected_diagrams.sql` -- `diagrams.projected BOOLEAN NOT NULL DEFAULT false`; `generations.kind TEXT NOT NULL DEFAULT 'diagrams' CHECK (kind IN ('architecture','diagrams'))`. Existing rows stay LLM-drawn diagram traces.
- [ ] `src/services/projection.ts` -- `PROJECTED_TYPES` and `projectDiagram(type, model): LlmDiagram`, plus the three projectors -- the single source of truth for these views.
- [ ] `src/services/consistency.ts`, `src/services/llm.service.ts` -- as in the Code Map.
- [ ] `src/services/diagram.service.ts` -- as in the Code Map. Skip `generateDiagrams` when no LLM-drawn type remains.
- [ ] Repositories, training service, schema and controller -- the `projected` column and `kind` handling.
- [ ] Tests (minimal, per user): one small `tests/unit/projection.test.ts` (equal element sets, keyword alias, sanitising); update only the existing tests this change breaks.
- [ ] `_bmad-output/implementation-artifacts/deferred-work.md` -- trainer support for `kind=architecture`, which is needed because projected-only requests now produce no `diagrams` trace.

**Acceptance Criteria:**
- Given any valid architecture model, when all three projected views are produced, then the element sets are identical and each equals the model's elements.
- Given a revision whose architecture is unchanged, when the views are re-projected, then they are byte-identical to the previous ones.
- Given the existing trainer, when it pulls with no `kind`, then every line validates against its current strict schema.

## Design Notes

A sequence projection shows the main flow as one lifeline set. It has no alt/loop fragments, because the model has no branches; that's an accepted trade for guaranteed consistency. Titles are fixed: "Main flow", "Components", "Communication".

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors.
- `npm test` -- written, **not run** (per the user; run only when asked).

## Implementation Notes

- Migration `006_generation_per_kind.sql`: `generations.message_id` was UNIQUE (002), which broke the second (diagrams) trace; replaced by UNIQUE (message_id, kind).
- Follow-up round (user asked for all diagram-quality improvements):
  - **Causal flow.** `flowIssues` in `consistency.ts` is fed back through `completeJson` on the architecture call. An interaction must start from an actor, an external, or an element an earlier interaction reached; datastores never start one.
  - **Replies.** An optional `returns` on interactions is drawn as a dashed reply in the sequence view.
  - **Layers.** An optional `layer` on elements groups views: Mermaid `box transparent <layer>`, PlantUML `package`.
  - **Sequence view.** It now has `autonumber`, and external elements are labelled "(external)".
  - **Feedback in context.** On an update, the owner's ratings and comments on the previous version (`FeedbackRepository.findForMessage`) are added to both prompts. The "Requested diagram types" listing stays last, as the trainer parses it.
  - Rendering of samples with `box`, `package`, `<<external>>` and `\n` labels was confirmed against local Kroki.
- Per the user: no test files written or changed after their instruction, and no lint/typecheck until a commit is requested.
- Diagram-quality round (reviewed against the SEBI prompt):
  - **Model checks** (`architectureIssues` = flow + reply + R1 datastore writer/reader, with an `intentional_reason` escape hatch, + R5 non-human trigger for monitoring language). They are retried up to 2 times, then persisted with warnings.
  - **Architecture prompt:** coverage and naming, analysis inputs, monitoring (scheduler plus skip already-processed items), replies only via `returns`, orchestrated steps return their outcome.
  - **Follow-ups** now carry the conversation's first prompt as "Original requirements" (it was dropped after one follow-up).
  - **Sequence projection:**
    - order by first activation, then hub at its partners' median, then a crossing-minimising local search over layer units and within layers; externals are pinned next to a sole partner;
    - explicit reply steps are drawn dashed and never get a synthesised reply;
    - no reply for fire-and-forget verbs (`FIRE_AND_FORGET_VERBS`, overridable via `ProjectionOptions`).
  - **Component view:** drops explicit-reply arrows and shows at most 2 messages per dependency.
  - **Scratch check on the stored SEBI model:** lifelines crossed 55 → 48, and the orchestrator is no longer at the edge. SEBIWebsite is adjacent to CircularFetcher, all 3 checks fire, and all 3 views render in Kroki.
  - Tests from the task (F1–F3 unit tests, F4 feedback-loop integration test) were not written, per the user's no-test-files instruction.

## Spec Change Log

## Review Triage Log
