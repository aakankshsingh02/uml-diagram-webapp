- source_spec: none
  summary: Login/signup UI and session lifecycle (store token on login, logout, 401 → sign-in prompt) against the backend's new /api/auth endpoints.
  evidence: Split from spec-rate-diagrams at step-01 multi-goal gate; independently shippable. Backend session backend-31 introduced bearer auth mid-cycle, so without this UI every API call returns 401 in the running app.
- source_spec: none
  summary: Conversation history (PRD FR-8) — list and reopen conversations using the backend's new GET /api/conversations.
  evidence: PRD FR-8 [LATER]; the backend listing endpoint now exists (added by backend-31), so this is unblocked.
- source_spec: `_bmad-output/implementation-artifacts/spec-rate-diagrams.md`
  summary: Restore a diagram's existing rating (and comment) when a conversation is reopened.
  evidence: Review finding 14. RateDiagram always starts unrated; the API's conversation payload has no per-diagram feedback for the caller.
- source_spec: `_bmad-output/implementation-artifacts/spec-rate-diagrams.md`
  summary: Move the session from a localStorage bearer token to an httpOnly SameSite cookie.
  evidence: Review finding 15. Any XSS can read localStorage; this needs the backend to issue cookies and enforce CSRF protection.
- source_spec: none
  summary: RESOLVED by session backend-31 (2026-09-30): the login/signup UI and conversation history (FR-8) entries above.
  evidence: backend-31 reports features/auth, entities/{user,conversation}, pages/chat sidebar + ChatPage auth gate; frontend test, lint, lint:fsd, typecheck and next build pass.
