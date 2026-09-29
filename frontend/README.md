# UML Chat — Frontend

Next.js 16 (App Router) + TypeScript + Tailwind v4, organised with [Feature-Sliced Design](https://feature-sliced.design).

```
app/                     Next.js routing only (layout, page files re-export FSD pages)
src/
  app/                   FSD app layer: global styles, providers
  pages/chat/            chat screen composition
  widgets/chat-thread/   conversation timeline
  features/generate-diagrams/   prompt composer, API call, chat session state
  entities/diagram/      diagram Zod schema, type catalogue, DiagramCard
  shared/                api client (Zod-validated), config, lib, ui kit
```

Next's router lives in the root `app/`. The root `pages/` folder is intentionally empty. Next requires its `app` and `pages` routers to sit in the same folder, and without the empty root `pages/`, `next build` finds FSD's `src/pages` layer and fails. The `@/*` alias maps to `src/*`, and `@test/*` maps to `test/*` (test-only helpers kept outside the FSD tree).

## Tests

`npm test` runs Vitest with Testing Library in jsdom. Test files sit next to the code they cover (`*.test.ts(x)`), and `fetch` is stubbed with `test/mock-fetch.ts`.

## Auth

The backend requires `Authorization: Bearer <session token>`. `shared/api` reads the token from `localStorage["uml.sessionToken"]` and clears it on a 401. There's no login/signup UI yet (see `_bmad-output/implementation-artifacts/deferred-work.md`), so the token currently has to be set by hand.

Layer imports only go downward (`pages → widgets → features → entities → shared`), and slices are imported only through their `index.ts`. `npm run lint:fsd` (Steiger) enforces this.

## Scripts

`npm run dev` · `npm run build` · `npm run lint` · `npm run lint:fsd` · `npm run typecheck`

Set `NEXT_PUBLIC_API_URL` in `.env.local` (default `http://localhost:4000/api`).
