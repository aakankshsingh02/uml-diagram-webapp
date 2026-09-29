# Reward design

## Why rollouts are on-policy

ART trains on completions its own trainable model generated, and it learns from the differences in reward inside a group. The exported Groq output isn't from that model, so it's used as context, not as a training target. Each exported generation becomes a **scenario**:

| Scenario field | From the export line |
|---|---|
| `id` | `id` (generation id; acked after training) |
| `messages` | `messages_and_choices[0:2]` (system + user, exactly what the API sent) |
| `human_reward` | `reward` |
| `feedback` | `metadata.feedback[]` (type, rating, comment) |
| `requested_types` | the diagram types parsed from the user message, or taken from the feedback types |

Scenarios are ordered with the lowest `human_reward` first, because a thumbs-down is the most informative signal, and each run is capped at `--max-scenarios`.

## Rollout score (in [0, 1])

1. **Format gate.** The assistant reply must parse as JSON and pass the strict schema `{diagrams:[{type,title,source}]}`, covering every requested type. If it fails, the score is **0** and the rollout skips the render and judge steps.
2. **Render rate.** The fraction of diagrams that Kroki renders (engine chosen per type, the same table the backend uses). Kroki 400 counts as a failure. A transport error aborts the run, so an outage never poisons the reward.
3. **RULER.** `ruler_score_group` scores the group of valid rollouts from 0 to 1 against a rubric made of the base rubric plus the scenario's feedback:
   > A user reviewed an earlier answer to this request. Feedback on the `<type>` diagram: 👎 "`<comment>`". Prefer answers that fix these issues.
4. **Combined:** `reward = 0.5 · render_rate + 0.5 · ruler`. The parts are recorded in `metrics` (`format_ok`, `render_rate`, `ruler`, `human_reward`).

A group where every rollout has the same reward is left out of the training step, because it carries no signal for GRPO. When a step succeeds, **every** pulled id is acked, including the left-out ones, so an uninformative scenario isn't pulled forever. If no group is trainable, no step runs and nothing is acked. The next run resamples at temperature 1.0 and may find variance.
