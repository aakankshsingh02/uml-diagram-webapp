# Diagram types (UML 2.x)

| id                     | Group       | Engine   | Use for                                               |
| ---------------------- | ----------- | -------- | ----------------------------------------------------- |
| `class`                | Structure   | mermaid  | Domain/API design, schemas                            |
| `object`               | Structure   | plantuml | Runtime instance snapshots, multiplicity examples     |
| `component`            | Structure   | plantuml | Service/module boundaries, provided/required ifaces   |
| `composite_structure`  | Structure   | plantuml | Internal parts/ports/connectors of a component        |
| `deployment`           | Structure   | plantuml | Runtime topology: nodes, containers, artifacts        |
| `package`              | Structure   | plantuml | Namespaces, layering, dependencies                    |
| `profile`              | Structure   | plantuml | Stereotypes, tagged values (e.g. «microservice», PII) |
| `use_case`             | Behavior    | plantuml | Actors, goals, system scope                           |
| `activity`             | Behavior    | mermaid  | Workflows, pipelines, decisions, swimlanes            |
| `state_machine`        | Behavior    | mermaid  | Lifecycles: states, events, guards                    |
| `sequence`             | Interaction | mermaid  | Time-ordered messages, API request lifecycles         |
| `communication`        | Interaction | plantuml | Same as sequence, emphasising links                   |
| `interaction_overview` | Interaction | plantuml | Control flow stitching interactions                   |
| `timing`               | Interaction | plantuml | State/value over time, SLA/timeout analysis           |

Engine rule: Mermaid where it has native UML syntax (`classDiagram`, `sequenceDiagram`, `stateDiagram-v2`, `flowchart`). PlantUML (bundled in Kroki core) covers the rest.

Aliases (case/space/hyphen-insensitive): `sequential`→`sequence`, `state`/`statemachine`→`state_machine`, `usecase`→`use_case`, `composite`→`composite_structure`, `overview`→`interaction_overview`.
