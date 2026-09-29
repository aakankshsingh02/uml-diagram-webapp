- source_spec: `_bmad-output/implementation-artifacts/spec-feedback-rl-trajectories.md`
  summary: Replace the timestamp export watermark with a monotonic feedback revision (sequence) echoed on ack.
  evidence: Review #2. A feedback upsert executing just before the export snapshot but committing after it can be acked unexported (sub-ms window).
- source_spec: `_bmad-output/implementation-artifacts/spec-feedback-rl-trajectories.md`
  summary: Index and bound the export query (feedback(updated_at) index, restrict the CTE to changed feedback).
  evidence: Review #16. The CTE aggregates all feedback on every pull; cost grows with total feedback, not pending.
- source_spec: `_bmad-output/implementation-artifacts/spec-feedback-rl-trajectories.md`
  summary: Make ART groups trainable: resample N rollouts per exported prompt (or group near-identical prompts) and score with RULER anchored on human reward.
  evidence: Review #18 and SPEC open question. group_id = message_id gives groups of size 1, so GRPO advantages are zero.
- source_spec: `_bmad-output/implementation-artifacts/spec-feedback-rl-trajectories.md`
  summary: Expose the caller's own feedback per diagram (in the conversation payload) and allow retracting it.
  evidence: Review #19. The UI can't restore rating state after a reload.
- source_spec: `_bmad-output/implementation-artifacts/spec-feedback-rl-trajectories.md`
  summary: Backfill or reject feedback on diagrams created before migration 002 (no generation row, so never exported).
  evidence: Review #15. Affects pre-002 dev data only.
