# Addendum — UML Chat API

## Stack decisions
- **Groq with JSON mode, then Zod.** Groq's `json_object` response format together with a strict Zod schema is portable across Groq models. Groq's `json_schema` mode is limited to certain models. Validation errors go back to the model because a retry with the error attached is cheaper than failing the request.
- **Kroki self-hosted.** One HTTP API covers Mermaid, PlantUML and Excalidraw. A 400 response carries the parser message, and that message is what drives Repair.
- **Mermaid vs PlantUML.** Mermaid has native UML syntax for only 4 of the 14 types. PlantUML covers the full UML 2.x set and is bundled in Kroki core, so it costs nothing extra.
- **pg + SQL migrations (not an ORM).** The repositories own the SQL, and `UNNEST` is used for batch inserts.

## ART integration notes
- ART trains open-weight models with GRPO. A `TrajectoryGroup` needs rollouts of the same task that got different rewards, otherwise the advantage is zero.
- The product gives one rollout per Message. Options for the trainer: (a) resample N rollouts per exported prompt and score them with RULER, using the human Reward as a calibration anchor; (b) accumulate Messages with near-identical Prompts into one group. We recommend (a).
- The export is intentionally a pull with explicit acknowledgement, so a crashed training run loses nothing.

## Rejected alternatives
- **Mark-on-read export:** a trainer crash would drop data silently.
- **Per-diagram Trajectories:** one LLM completion produces every Diagram, so splitting it would credit the reward to output the model didn't generate separately.
