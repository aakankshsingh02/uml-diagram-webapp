# UML Chat

Chat-based UML generator: describe a system, pick UML diagram types, and get rendered diagrams. Follow-up prompts update the same design as a new version.

```
frontend/   Next.js 16 (App Router, TS, Tailwind v4), Feature-Sliced Design     :3000
backend/    Node + Express 5 (TS, ESM), controller → service → repository     :4000
docker      Postgres 17 · Kroki (PlantUML built in) + Mermaid + Excalidraw   :5432 / :8000
```

`frontend/` and `backend/` are fully independent: each has its own `package.json`, lockfile, `node_modules`, env file, and its own [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) install (`_bmad/`, `.claude/skills/`). Open each folder on its own when you work with BMAD agents.

## Quick start

```bash
# 1. Infrastructure
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env          # set GROQ_API_KEY
npm install
npm run db:migrate
npm run dev                   # http://localhost:4000/api/health

# 3. Frontend (new terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

## Request flow

1. The frontend validates the request with Zod and sends `POST /api/diagrams/generate`.
2. The backend validates the body with a strict Zod schema. Unknown keys are rejected, and diagram type aliases such as `"sequential"` are normalized.
3. Groq (JSON mode) returns `{ diagrams: [...] }`, and a strict Zod schema checks it. If validation fails, the error goes back to the model and it gets one retry.
4. Every diagram is rendered by Kroki at the same time. Mermaid handles class, sequence, state and activity; PlantUML handles the other UML types. If Kroki rejects the syntax, the parser error goes back to the LLM for one repair, and the diagram is rendered again.
5. The message and diagrams are saved in a single transaction, and the version number goes up by one for each prompt in the conversation.

## API

| Method | Path                       | Body / notes                                                        |
| ------ | -------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/health`              | DB + Kroki + LLM key status                                         |
| POST   | `/api/diagrams/generate`   | `{ user_id, conversation_id?, prompt, diagram_types[] }`            |
| GET    | `/api/conversations/:id`   | All versions with their diagrams                                    |

The `feedback` table already exists for collecting training data for the RL trainer (LangChain ART). There is no feedback endpoint yet.
