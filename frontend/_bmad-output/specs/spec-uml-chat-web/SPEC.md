---
id: SPEC-uml-chat-web
companions: []
sources:
  - ../../../../task.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# UML Chat Web Client

## Why

The vision is a chat where describing a system produces UML you can read, iterate on and judge. The mandate is that the brief requires user feedback to reach an RL trainer, and the UI is the only place that feedback comes from. If rating a diagram takes more than one click, the trainer gets no data.

## Capabilities

- **CAP-1**
  - **intent:** A user writes a design prompt, picks any of the 14 UML diagram types, and sees one rendered diagram per type.
  - **success:** The user submits the SEBI prompt with Sequence and Component selected, and two diagram cards appear, each with its title, type and rendered image.
- **CAP-2**
  - **intent:** A follow-up message in the same chat updates the design. Each result shows its version number, and earlier versions stay visible.
  - **success:** After a follow-up, the thread shows "Version 1" and "Version 2" results in order, and the composer is labelled as an update.
- **CAP-3**
  - **intent:** A user rates each diagram with thumbs up or down and an optional comment. The rating persists and is shown as selected.
  - **success:** Clicking thumbs-down sends one feedback request, the button shows as pressed, and changing to thumbs-up replaces the earlier rating. If the request fails, an error appears and the rating isn't shown as selected.
- **CAP-4**
  - **intent:** SVGs are displayed without running any script they contain. A failed render shows the error and the diagram source.
  - **success:** The SVG is shown through an `<img>` data URL, never injected as HTML. A diagram with `svg: null` shows `render_error` and its source.
- **CAP-5**
  - **intent:** The user always sees progress while diagrams are generating and can't submit twice.
  - **success:** While a request is running, the submit button is disabled and a "Generating…" placeholder is shown.
- **CAP-6**
  - **intent:** A returning user can reopen a previous conversation after reloading the page.
  - **success:** After a reload, the user can pick their earlier conversation and see all of its versions.

## Constraints

- Every API response is Zod-validated before use. An unexpected shape shows up as an error instead of a silently broken UI.
- FSD layering is enforced by Steiger, and Next routing lives only in the root `app/`.
- The frontend runs independently. Its only link to the backend is `NEXT_PUBLIC_API_URL`.

## Non-goals

- A diagram editing canvas. Changes are made through prompts only.
- Accounts or login in v1.

## Success signal

On a fresh browser: generate the SEBI diagrams, send a follow-up, thumbs-down one diagram with a comment, and reload. The rating is stored (it appears in the backend's training export), and after CAP-6 ships the conversation can be reopened.

## Assumptions

- The user id is an anonymous per-browser id stored in localStorage until auth exists.
- A rating can be changed later (the latest one wins), and a comment is optional for both thumbs up and down.
