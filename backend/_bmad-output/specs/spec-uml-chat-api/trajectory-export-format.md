# Trajectory export format (ART)

Target consumer: the OpenPipe ART trainer through its LangChain/LangGraph integration. Each line maps 1:1 onto `art.Trajectory`. Lines with the same `group_id` form one `art.TrajectoryGroup`.

## Unit

- **Trajectory** = one generation, meaning one LLM completion that produced every diagram for one message.
- **Group** = the message the generation belongs to (same prompt), so `group_id = message_id`.
- A generation is **exportable** when at least one of its diagrams has feedback, and either `exported_at IS NULL` or the latest feedback `updated_at > exported_at`. This means changing feedback after an export makes the generation exportable again.

## Line shape (JSON Lines, `application/x-ndjson`)

```json
{
  "id": "<generation uuid>",
  "group_id": "<message uuid>",
  "messages_and_choices": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "<raw JSON the model returned>" }
  ],
  "reward": -0.5,
  "metrics": {
    "diagrams": 2,
    "rated": 1,
    "positive": 0,
    "negative": 1,
    "render_failures": 0,
    "repaired": 0,
    "attempts": 1,
    "latency_ms": 5210
  },
  "metadata": {
    "model": "openai/gpt-oss-120b",
    "conversation_id": "<uuid>",
    "version": 1,
    "created_at": "<ISO-8601>",
    "feedback": [
      { "diagram_id": "<uuid>", "type": "sequence", "engine": "mermaid", "rating": -1, "comment": "missing SEBI fetcher" }
    ]
  }
}
```

`messages_and_choices` holds only the successful exchange: system, user, and the final assistant message that passed validation. Earlier failed attempts are counted in `metrics.attempts`.

## Reward

Each diagram gets a score:

- rating −1 → −1
- rating +1 → +1
- no rating → 0
- didn't render as generated (render failed, or only rendered after a Repair) → −1, overriding any rating. The trajectory holds the model's original output, so a Repair doesn't earn credit.

`reward` is the mean of these scores across all diagrams in the generation, rounded to 3 decimals, so it falls in [−1, 1].

## Endpoints (require `Authorization: Bearer $TRAINING_API_TOKEN`; the scheme is case-insensitive)

- `GET /api/training/trajectories?limit=N` returns up to N exportable generations (default 100, max 1000), ordered by generation `created_at` ascending with `id` as the tie-break.
- The export response has an `X-Export-As-Of` header, which is the database time when the export query ran.
- `POST /api/training/trajectories/ack` with `{ "ids": [uuid, ...], "as_of": "<X-Export-As-Of>" }` sets `exported_at = GREATEST(exported_at, LEAST(as_of, now()))` on those generations (the watermark never moves backwards or into the future) and returns `{ "acknowledged": n }`. Feedback changed between the pull and the ack is still exported next time.
- If the token isn't configured on the server, both return 503. A missing or wrong token returns 401.
