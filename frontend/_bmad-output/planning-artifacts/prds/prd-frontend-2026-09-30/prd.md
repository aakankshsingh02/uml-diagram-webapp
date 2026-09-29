---
title: UML Chat Web Client
status: final
created: 2026-09-30
updated: 2026-09-30
spec: ../../../specs/spec-uml-chat-web/SPEC.md
---

# PRD: UML Chat Web Client

## 0. Document Purpose

This PRD is for the frontend builder and for the BMAD build, review and QA runs in `frontend/`. It is brownfield: the chat, the Diagram Type picker and diagram display already exist. FR delivery tags are **[BUILT]**, **[CYCLE-1]** (this cycle) and **[LATER]**. The API contract it depends on is summarised in §5. The backend's own PRD lives in `backend/_bmad-output` and is deliberately not referenced by path, because the two folders are independent.

## 1. Vision

The chat is where a design turns into pictures and where the product learns what "good" means. Every Diagram arrives with a one-click way to say whether it's right. The thesis: **if rating a Diagram takes more than one click, the training loop starves.**

## 2. Target User

- **UJ-1. Asha drafts and judges.** Asha, a solution architect, pastes the SEBI circular-monitoring brief, keeps Sequence and Component selected, and presses Generate. Two cards appear. The component view is missing the circular fetcher, so she clicks 👎, types "missing SEBI fetcher" and sends it. The button stays pressed. She writes a follow-up, and a Version 2 result appears under Version 1. **Edge case:** the network drops while she's rating. She sees an error, and the button doesn't stay pressed.
- **UJ-2. Asha comes back tomorrow.** She reloads the page and reopens yesterday's Conversation to continue it. [LATER]

## 3. Glossary

- **Conversation**, **Version**, **Diagram**, **Diagram Type**, **Rating** (+1/−1), **Feedback** (a Rating plus an optional comment): the same meanings as in the API.
- **Turn** — one Prompt the user sent and the result it produced (the Diagrams, or an error).
- **Diagram Card** — the UI unit that shows one Diagram: title, type, image or source, and its Rating controls.

## 4. Features

### 4.1 Compose and generate
#### FR-1: Compose a Prompt [BUILT]
- The textarea and 14 Diagram Type toggle chips send the request. Submit is disabled while the Prompt is under 10 characters, no type is selected, or a request is in flight. Ctrl/⌘+Enter submits.
#### FR-2: Thread with Versions [BUILT]
- Each Turn shows the Prompt, its Diagram Types, and then "Version N" with its Diagram Cards, or an error. Follow-ups reuse the Conversation, and the submit label changes to "Update diagrams". "New chat" starts a new Conversation.
#### FR-3: Pending state [BUILT]
- While a Turn is pending, it shows "Generating diagrams…" and submitting is disabled.

### 4.2 Diagram display
#### FR-4: Safe SVG display [BUILT]
- The SVG is shown in an `<img>` using a `data:` URL and is never injected as HTML. A source toggle shows the Diagram Source.
#### FR-5: Render failure display [BUILT]
- When `svg` is null, the card shows the Render Error and the source.

### 4.3 Feedback
#### FR-6: Rate a Diagram [CYCLE-1]
- Each Diagram Card has 👍 and 👎 buttons (`aria-pressed`) and an optional comment field (≤ 2,000 characters). Selecting a Rating sends one request with the comment typed so far. Submitting the comment sends the currently selected Rating plus the comment. Buttons are disabled while a request is in flight.
- On success, the selected button shows `aria-pressed="true"` and a "Thanks" confirmation appears. On failure, the error message is shown, and the selection reverts to the last Rating the server confirmed.
#### FR-7: Change a Rating [CYCLE-1]
- Choosing the other Rating replaces the earlier one (the API upserts). Choosing the same Rating again does nothing.

### 4.4 History
#### FR-8: Reopen a Conversation [LATER]
- After a reload, the user can list their Conversations and open one, with all Versions shown.

## 5. API dependency (summary)

- `POST /api/diagrams/generate` → `{conversation_id, version, diagrams[]}` [BUILT]
- `POST /api/diagrams/:id/feedback {user_id, rating, comment?}` → 200 `{id, diagram_id, rating, comment}` [CYCLE-1]
- A listing endpoint for Conversations is needed for FR-8 and doesn't exist yet.

## 6. NFRs

- Every response is Zod-validated. A contract mismatch shows up as an error message, never as a blank card.
- Accessibility: Rating buttons have accessible names ("Rate helpful" / "Rate not helpful") and `aria-pressed`, and everything is keyboard-operable.
- Steiger reports no problems. `tsc` and ESLint are clean.

## 7. Non-Goals

- A diagram editing canvas.
- Login or accounts.

## 8. MVP Scope

**In:** FR-1 to FR-7. **Out:** FR-8, because it needs a backend listing endpoint.

## 9. Success Metrics

- **SM-1:** At least 20% of Diagram Cards shown get a Rating (this mirrors the API's SM-2). Validates FR-6.
- **SM-C1 (counter):** Don't nag users for Ratings (no modal prompts). Counterbalances SM-1.

## 10. Open Questions

1. Should a 👎 without a comment prompt the user for a reason inline? (Deferred. The comment stays optional for now.)
