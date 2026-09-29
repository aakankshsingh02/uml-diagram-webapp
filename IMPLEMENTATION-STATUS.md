# UML Chat: implementation status against `task.md`

_As of 2026-09-30, after one BMAD cycle (spec → PRD → build → review → QA) in `backend/` and `frontend/`. The auth and chat-history work came from a parallel session (`backend-31`)._

**None of the final test runs have happened yet. They're waiting for your go-ahead** (see the end of this document).

## 1. The three cases in `task.md`

| Case | Status | What exists | What's left |
|---|---|---|---|
| **1. New user sends a request and gets output** | ✅ Done | Signup/login, then `POST /diagrams/generate`. Zod-validated LLM output is rendered by Kroki to SVG, with one diagram per requested type. Verified live against Groq (5.4 s, then 3.7 s for 2 diagrams). | Only sequence, component, use-case and state have been generated live. The other 10 PlantUML types (timing, profile, interaction overview, …) are accepted but their live quality is unverified. |
| **2. Existing user sends an updated prompt** | ✅ Done | The same `conversation_id` produces a new version, with the previous prompt and diagrams sent to the model as context. Earlier versions stay visible, and the chat can be reopened after a reload through the sidebar. | The UI can't show two versions side by side (no diff). A rating isn't restored when a chat is reopened (see §3). |
| **3. Feedback passed to the LangChain ART plugin** | ⚠️ Half done | 👍/👎 plus a comment on each diagram. Each generation (system, user and assistant messages, attempts, latency) is stored, and the trainer pulls NDJSON `art.Trajectory` lines through a token-protected export with pull + ack. | **The ART trainer itself doesn't exist.** See §2, item 4. |

## 2. The four technical considerations

1. **Rendering UML in the UI.** ✅ Kroki (Mermaid for class, sequence, state and activity; PlantUML for the rest) renders SVG, which is shown through `<img>` so no script inside it can run. Failed renders show the error and the source.
   *Left:* SVG/PNG download, zoom and pan. Excalidraw is running but no diagram type uses it.
2. **Controlling syntax errors.** ✅
   - Strict Zod checks the model's JSON, with one retry that feeds the validation error back.
   - Kroki's parser error drives one LLM repair.
   - Renderer outages are retried and never "repaired".
   - The live run needed 2 attempts, so the retry path is doing real work.

   *Left:* track first-try success rate (PRD SM-1 target ≥ 85%).
3. **Minimising latency.** ⚠️ Only parallel rendering is done.
   *Left:* PRD FR-15 (stream each diagram as soon as it renders), FR-16 (parallel model calls per diagram type), FR-17 (render cache), and real latency targets. The p95 ≤ 15 s target is an assumption.
4. **Collecting and storing feedback for the RL trainer.** ✅ for storage and export. ❌ for training.
   *Left:*
   - A Python ART service that pulls and acks trajectories and trains.
   - **Decide the grouping.** Each export group holds one rollout, so GRPO learns nothing. The trainer has to resample several rollouts per prompt or use RULER, with the human rating as an anchor.
   - Choose the open-weight model and where it's served. Groq can't host ART LoRA weights.
   - Replace the timestamp watermark with a monotonic revision (there's a sub-millisecond race).
   - Index the export query.

## 3. Deferred work from the BMAD reviews

Full entries are in each folder's `_bmad-output/implementation-artifacts/deferred-work.md`.

- **Backend:**
  - monotonic export watermark;
  - export query index;
  - trainable ART grouping;
  - return the viewer's rating per diagram and allow retracting it;
  - backfill feedback on diagrams created before migration 002.
- **Frontend:**
  - restore a diagram's rating when a chat is reopened (needs the backend change above);
  - move the session token from localStorage to an httpOnly cookie (needs the API to issue cookies and handle CSRF).

## 4. Decisions waiting on you (from the auth review)

`backend-31` fixed the bugs (bounded scrypt parameters, rehash on login, a cap on concurrent hashing, TTL cap, test assertions). These need your call:

- **Rate limiting** per IP and per email on `/auth/*` and `/diagrams/generate`. Generate spends paid Groq calls. **Recommended before any public deploy.**
- **Signup 409** reveals which emails are registered. Accept this, or switch to a neutral response.
- **Account lifecycle:** password reset/change, log out of all devices, purging expired sessions.
- **Pagination** for `GET /api/conversations`.

## 5. Project and ops gaps

- **Git isn't initialised** at the root (no history, and BMAD's version-control steps were skipped). Add a `.gitattributes` with `eol=lf` too.
- No CI pipeline, and no Dockerfiles for the two apps (Compose only runs Postgres and Kroki).
- No production config: CORS allow-list, HTTPS, log redaction, backups.
- Remove the old `uml.userId` key from browsers (harmless leftover).

## 6. BMAD lifecycle status

| Phase | backend/ | frontend/ |
|---|---|---|
| Spec (`bmad-spec`) | ✅ `specs/spec-uml-chat-api` (8 capabilities, 2 companions) | ✅ `specs/spec-uml-chat-web` (6 capabilities) |
| PRD (`bmad-prd`) | ✅ FR-1…17, rubric reviewed | ✅ FR-1…8, rubric reviewed |
| Build (`bmad-build`) | ✅ `spec-feedback-rl-trajectories` done (1 review loop) | ✅ `spec-rate-diagrams` done |
| Review (3 parallel reviewers) | ✅ 2 passes: 19 patched, 7 deferred, 6 false | ✅ 1 pass: 10 patched, 4 deferred, 3 false |
| QA (`bmad-qa-generate-e2e-tests`) | ⚠️ 17 API tests written. The QA summary isn't written yet. | ⚠️ 2 Playwright tests (API mocked) plus 1 full-stack test written. The full-stack test was never run (you stopped it). The QA summary isn't written yet. |

## 7. Tests to run when you're ready

```bash
cd backend  && npm run typecheck && npm test          # Vitest + Supertest against uml_diagrams_test
cd frontend && npm run typecheck && npm run lint && npm run lint:fsd && npm test && npm run build
cd frontend && npx playwright test chat.mocked        # browser E2E, API mocked
# Opt-in: spends one real Groq call
cd frontend && E2E_FULLSTACK=1 E2E_TRAINING_TOKEN=<backend TRAINING_API_TOKEN> npx playwright test fullstack
```

Results from the last runs, before other changes landed. These aren't final.

- Backend: 54/54 in my run and 17/17 in the new QA file. `backend-31` reported 85/85 afterwards, which I haven't checked myself.
- Frontend: 28/28 unit tests and 2/2 mocked E2E; typecheck, lint, Steiger and build were all clean.

After the final run I'll write the BMAD QA summaries (`_bmad-output/implementation-artifacts/tests/test-summary.md` in each folder).
