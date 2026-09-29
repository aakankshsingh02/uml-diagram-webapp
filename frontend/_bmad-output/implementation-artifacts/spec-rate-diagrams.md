---
title: 'Rate diagrams (thumbs + comment) on an auth-aware API client'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-uml-chat-web/SPEC.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-frontend-2026-09-30/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Diagram cards have no way to rate a result, so no Feedback reaches the RL trainer (PRD FR-6, FR-7). The backend has also just moved to bearer-session auth and strict bodies without `user_id`, so the current client's requests are rejected.

**Approach:** Add a `rate-diagram` feature (👍/👎 plus an optional comment) rendered in each Diagram Card's footer. Switch the shared API client to send `Authorization: Bearer <session token>` and drop `user_id` from every request body.

## Boundaries & Constraints

**Always:**
- Follow the FSD layers: feature `rate-diagram`, with the entity card exposing a `footer` slot and the page composing them.
- Zod-validate the feedback response strictly.
- Rating buttons have accessible names and `aria-pressed`, and everything is keyboard-operable.
- Update the pressed state optimistically, and revert to the last Rating the server confirmed if the request fails.

**Never:**
- Build a login/signup UI (deferred).
- Inject the SVG as HTML.
- Add a global state library.
- Send `user_id`.

**Decisions (auto-resolved, user-approved run-through):**
- The token is read from `localStorage["uml.sessionToken"]`. When it's absent, no Authorization header is sent, and the API's 401 surfaces as the normal error text.
- Choosing the same Rating again with an unchanged comment does nothing.
- "Send comment" re-sends the currently confirmed Rating with the comment. It is disabled until a Rating is confirmed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First rating | click 👎 | one POST `{rating:-1}`, 👎 `aria-pressed=true`, "Thanks" shown | N/A |
| Rating with typed comment | comment "missing fetcher", click 👍 | POST `{rating:1, comment:"missing fetcher"}` | N/A |
| Change rating | 👎 confirmed, click 👍 | POST `{rating:1}`, 👍 pressed, 👎 not | N/A |
| Same rating again | 👍 confirmed, click 👍 | no request | N/A |
| Send comment | 👍 confirmed, type, click Send | POST `{rating:1, comment}` | N/A |
| Server error | POST returns 500 | error text shown (`role=alert`), selection reverts to the last confirmed Rating | no crash |
| In flight | request pending | both buttons and Send disabled | N/A |
| Auth header | token in storage | request carries `Authorization: Bearer <token>` | absent token → no header |
| Generate body | submit prompt | body has `prompt` and `diagram_types` only | N/A |

</frozen-after-approval>

## Code Map

- `src/shared/api/http.ts` — `apiRequest`: add the bearer header from the session store. Reuse `ApiError` and the Zod parse path.
- `src/shared/lib/user-id.ts` → replaced by `src/shared/lib/session.ts` (`getSessionToken`/`setSessionToken`). Update `src/shared/lib/index.ts`.
- `src/features/generate-diagrams/api/generateDiagrams.ts`, `model/useChatSession.ts` — drop `user_id` and `getUserId`.
- `src/entities/diagram/ui/DiagramCard.tsx` — add an optional `footer?: ReactNode` rendered below the image/source.
- `src/features/rate-diagram/` — new: `api/submitFeedback.ts`, `model/useDiagramRating.ts`, `ui/RateDiagram.tsx`, `index.ts`.
- `src/pages/chat/ui/ChatThread.tsx` — pass `<RateDiagram diagramId={d.id} />` as the card footer.
- Tests: Vitest + Testing Library (jsdom) for the matrix. The QA phase adds Playwright E2E.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/lib/session.ts`, `src/shared/api/http.ts` — auth-aware client — backend now requires a bearer session
- [x] `src/features/generate-diagrams/*` — remove `user_id` — the strict backend rejects unknown keys
- [x] `src/entities/diagram/ui/DiagramCard.tsx` — footer slot — an entity can't import a feature
- [x] `src/features/rate-diagram/*` — the rating feature — FR-6, FR-7
- [x] `src/pages/chat/ui/ChatThread.tsx` — compose the feature into the page
- [x] `vitest.config.mts`, `src/features/rate-diagram/ui/RateDiagram.test.tsx`, `src/shared/api/http.test.ts` — matrix tests

**Acceptance Criteria:**
- Given the checks, when `npm run typecheck`, `npm run lint`, `npm run lint:fsd` and `npm test` run, then all succeed.

## Implementation Notes

- Implemented inline; the test helper moved to `test/mock-fetch.ts` with an `@test/*` alias because Steiger forbids deep imports that sidestep `shared/api`'s public API.
- The API client clears the stored session on a 401 (backend-31's contract note). Not in the matrix, but covered by `http.test.ts`.
- `@types/node` was bumped ^20 → ^24 to match the Node 24 runtime (Vitest 5 peer requirement).
- **Pre-existing build break found and fixed:** `next build` failed with "`pages` and `app` directories should be under the same folder" because FSD's `src/pages` sat next to the root `app/`. It had never been built before (the previous turn's shell outage). Added an empty root `pages/` (with a README), per FSD's Next.js guidance, and corrected the frontend README.
- Mutation check: removing the failure revert and the same-rating guard turned 2 tests red. Restored: 12/12 pass. tsc, ESLint and Steiger are clean, and `next build` passes.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap; run in parallel, context-free).

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Stale 401 clears a newer session (http.ts) | medium | patch | `setSessionToken(null)` cleared whatever was stored; now only if `getSessionToken() === token`; test "keeps a newer session…" |
| 2 | `Headers` instance spread to `{}` (http.ts, mock-fetch) | low | patch | Direct correction: `new Headers(rest.headers)`; mock records via `Object.fromEntries(new Headers())`; test added |
| 3 | Send comment has no unchanged guard | low | patch | `sendComment` now requires `dirty`; button disabled when the comment matches the confirmed one |
| 4 | "Thanks" stays while the comment has unsaved edits | low | patch | `saved` derived as confirmed && !pending && !dirty; test added |
| 5 | Live regions mounted conditionally; icon buttons not grouped | low | patch | `role=status` and `role=alert` always mounted; `role=group` + `aria-labelledby` |
| 6 | ZodError rendered as raw text | low | patch | Local `toMessage` with `z.prettifyError` |
| 7 | Test hard-codes the localhost API URL | low | patch | Asserts the path suffix instead |
| 8 | ChatThread → DiagramCard footer → RateDiagram wiring untested | medium | patch | New `ChatThread.test.tsx`: controls in every card, rating hits that card's diagram id |
| 9 | Re-rate via `rate()` after editing the comment untested | medium | patch | New test: clears the comment, clicks the same rating, and the second POST is `{rating:1}` |
| 10 | Saved comment can't be cleared | false | reject | Omitting `comment` makes the backend upsert store null (`backend/src/repositories/feedback.repository.ts`); covered by test #9 |
| 11 | Four files fully rewritten by a CRLF change | false | reject | `grep $''` finds no CR in any source file; an artifact of the snapshot diff |
| 12 | Lockfile missing, `@types/node` bump unexplained | false | reject | The diff tool didn't copy `package-lock.json` (it is updated); bump reason is in the Implementation Notes |
| 13 | No sign-in UI, so every call 401s | high | defer | Split to deferred-work at step 1; being built now by session backend-31 (auth + history) |
| 14 | Existing ratings not loaded after reload | medium | defer | Needs the API to return the caller's feedback per diagram; belongs to the history story |
| 15 | Bearer token in localStorage (XSS exposure) | medium (unverified exploit) | defer | The backend issues bearer tokens, not cookies; an httpOnly cookie needs an API change |
| 16 | Leftover `uml.userId` key | low | reject | Harmless stale key; the fix adds startup code for no user-visible gain |
| 17 | 401 surfaced only as ApiError, no app-level event | medium | defer | Auth UI (backend-31) adds a session subscribe in `shared/lib/session.ts` |
| 18 | No tests for session.ts and useChatSession | low | reject | session.ts is now owned by backend-31; useChatSession is being rewritten there |

Post-patch: tsc, ESLint and Steiger clean; 17/17 tests pass.

## Verification

**Commands:**
- `npm run typecheck && npm run lint && npm run lint:fsd && npm test` — expected: all exit 0
- `npm run build` — expected: exit 0
