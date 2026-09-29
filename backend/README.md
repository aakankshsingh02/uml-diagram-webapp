# UML Chat — Backend

Express 5 + TypeScript (ESM), layered as **controller → service → repository**.

```
src/
  config/env.ts          Zod-validated environment
  db/                    pg pool, transaction helper, migration runner
  schemas/               Zod request/LLM schemas (strict), diagram type → engine map
  middlewares/           body validation, error handling, session auth (require-auth)
  repositories/          SQL only (users, sessions, conversations/messages, diagrams)
  services/              business logic: DiagramService, LlmService (Groq), KrokiService, ...
  controllers/           HTTP in/out only
  routes/                route table
  container.ts           manual dependency wiring
  app.ts / server.ts
migrations/              plain SQL, applied in filename order
```

## Scripts

| Script               | What it does                           |
| -------------------- | -------------------------------------- |
| `npm run dev`        | watch mode (tsx), loads `.env`         |
| `npm run db:migrate` | apply pending `migrations/*.sql`       |
| `npm run typecheck`  | `tsc --noEmit` for src and tests       |
| `npm test`           | vitest + supertest (see Tests)         |
| `npm run build`      | compile to `dist/`                     |
| `npm start`          | run compiled build                     |

Requires Postgres and Kroki from `../docker-compose.yml`. `GROQ_API_KEY` is optional at boot (health works), but generation returns 503 without it.

## Auth

Accounts use email and password. `users.id` is a UUID v4 (`gen_random_uuid()`). Every other table references it as `user_id` (conversations, feedback, sessions), so chats are stored against the account and survive a reload.

- Passwords are hashed with scrypt from `node:crypto` (N=2^17, r=8, p=1, random 16-byte salt). The stored format is `scrypt$N$r$p$salt$key`.
- Signup and login return an opaque bearer token. Only its SHA-256 is saved in `sessions`. It expires after `SESSION_TTL_DAYS` (default 30), and logout revokes it.
- Clients send `Authorization: Bearer <token>`. `requireAuth` resolves it to `req.user`. The user always comes from the session and is never taken from the request body.

| Method | Path                        | Auth   | Body / notes                                              |
| ------ | --------------------------- | ------ | --------------------------------------------------------- |
| POST   | `/api/auth/signup`          | —      | `{ email, password }` (8–128 chars) → 201 `{ token, user }`; 409 if the email is taken |
| POST   | `/api/auth/login`           | —      | `{ email, password }` → `{ token, user }`; 401 on bad credentials |
| POST   | `/api/auth/logout`          | Bearer | 204, revokes this token                                    |
| GET    | `/api/auth/me`              | Bearer | `{ user }`                                                 |
| GET    | `/api/conversations`        | Bearer | `{ conversations: [{ id, title, created_at, updated_at }] }`, newest first |
| GET    | `/api/conversations/:id`    | Bearer | All versions with their diagrams; 404 if the conversation belongs to someone else |
| POST   | `/api/diagrams/generate`    | Bearer | `{ conversation_id?, prompt, diagram_types[] }`            |
| POST   | `/api/diagrams/:id/feedback`| Bearer | `{ rating: 1 \| -1, comment? }`                            |

Migration `003_auth.sql` drops the old anonymous `users.external_id`. Rows created before auth stay (their generations and feedback are training data), but they have no credentials, so nobody can sign in as them.

## RL training export (LangChain / LangGraph ART)

Every generate call stores one **generation**: the system, user and assistant messages that passed validation, plus the attempt count and model latency. User feedback turns generations into ART trajectories. The full format is in `_bmad-output/specs/spec-uml-chat-api/trajectory-export-format.md`.

| Method | Path                               | Auth                            | Notes |
| ------ | ---------------------------------- | ------------------------------- | ----- |
| GET    | `/api/training/trajectories?limit=N` | `Bearer $TRAINING_API_TOKEN` | NDJSON, one `art.Trajectory` per line (`group_id` = message). Only rated generations whose feedback is newer than their last ack. Response header `X-Export-As-Of`. |
| POST   | `/api/training/trajectories/ack`   | `Bearer $TRAINING_API_TOKEN` | `{ ids, as_of }`, where `as_of` is the `X-Export-As-Of` value you received. The watermark never moves backwards and is clamped to server time. |

- Both endpoints return 503 while `TRAINING_API_TOKEN` is unset and 401 for a wrong token.
- Reward is the mean per-diagram score: +1 or −1 from the rating, 0 if unrated, and −1 whenever the diagram didn't render as generated (it failed, or rendered only after a repair). The result is in [−1, 1].

## Tests

```bash
npm test          # vitest + supertest, needs Postgres from ../docker-compose.yml
```

Tests run against a separate database, `uml_diagrams_test` by default, which is created on first run (the DB user needs `CREATE DATABASE`). Override it by exporting `TEST_DATABASE_URL` in your shell (vitest doesn't read `.env`), but the name **must end in `_test`**, because tests truncate every table. Groq and Kroki are stubbed, so no API key is needed.
