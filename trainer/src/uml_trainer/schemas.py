"""Strict mirrors of the backend's contracts (unknown keys are rejected, like its Zod schemas)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DiagramType = Literal[
    "class",
    "object",
    "component",
    "composite_structure",
    "deployment",
    "package",
    "profile",
    "use_case",
    "activity",
    "state_machine",
    "sequence",
    "communication",
    "interaction_overview",
    "timing",
]
Engine = Literal["mermaid", "plantuml", "excalidraw"]

# Same table as backend/src/schemas/diagram.schema.ts ENGINE_BY_TYPE.
ENGINE_BY_TYPE: dict[str, Engine] = {
    "class": "mermaid",
    "sequence": "mermaid",
    "state_machine": "mermaid",
    "activity": "mermaid",
    "object": "plantuml",
    "component": "plantuml",
    "composite_structure": "plantuml",
    "deployment": "plantuml",
    "package": "plantuml",
    "profile": "plantuml",
    "use_case": "plantuml",
    "communication": "plantuml",
    "interaction_overview": "plantuml",
    "timing": "plantuml",
}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# --- Export line (backend trajectory-export-format.md) ---


class ChatMessage(Strict):
    role: Literal["system", "user", "assistant"]
    content: str


class ExportMetrics(Strict):
    diagrams: int
    rated: int
    positive: int
    negative: int
    render_failures: int
    repaired: int
    attempts: int
    latency_ms: int


class ExportFeedback(Strict):
    diagram_id: str
    type: DiagramType
    engine: Engine
    rating: Literal[1, -1]
    comment: str | None


class ExportMetadata(Strict):
    model: str
    conversation_id: str
    version: int
    created_at: str
    feedback: list[ExportFeedback]


class ExportLine(Strict):
    id: str
    group_id: str
    messages_and_choices: list[ChatMessage] = Field(min_length=3, max_length=3)
    reward: float = Field(ge=-1, le=1)
    metrics: ExportMetrics
    metadata: ExportMetadata

    @model_validator(mode="after")
    def _roles_in_order(self) -> "ExportLine":
        roles = [m.role for m in self.messages_and_choices]
        if roles != ["system", "user", "assistant"]:
            raise ValueError(f"messages_and_choices roles must be system, user, assistant (got {roles})")
        return self


# --- Model output (backend LlmDiagramsResponseSchema) ---


class LlmDiagram(Strict):
    type: DiagramType
    title: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1)


class LlmDiagrams(Strict):
    diagrams: list[LlmDiagram] = Field(min_length=1)
