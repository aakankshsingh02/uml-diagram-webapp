import json

import pytest

from uml_trainer.config import Settings

API = "http://api.test/api"
KROKI = "http://kroki.test"
AS_OF = "2026-09-30T10:00:00.123456Z"


def user_message(types: list[str], engines: dict[str, str] | None = None) -> str:
    engines = engines or {"sequence": "mermaid", "component": "plantuml", "class": "mermaid"}
    listing = "\n".join(f"- {t}: engine={engines[t]}" for t in types)
    return f"Requirements:\nSEBI circular monitoring\n\nRequested diagram types:\n{listing}"


def reply(*types: str, source: str = "graph TD; A-->B") -> str:
    return json.dumps({"diagrams": [{"type": t, "title": f"{t} view", "source": source} for t in types]})


def export_line(
    id: str = "gen-1",
    reward: float = -0.5,
    types: tuple[str, ...] = ("sequence", "component"),
    feedback: list[dict] | None = None,
) -> dict:
    feedback = (
        feedback
        if feedback is not None
        else [{"diagram_id": "d-2", "type": "component", "engine": "plantuml", "rating": -1, "comment": "missing SEBI fetcher"}]
    )
    return {
        "id": id,
        "group_id": f"msg-{id}",
        "messages_and_choices": [
            {"role": "system", "content": "You are a senior software architect..."},
            {"role": "user", "content": user_message(list(types))},
            {"role": "assistant", "content": reply(*types)},
        ],
        "reward": reward,
        "metrics": {
            "diagrams": len(types),
            "rated": len(feedback),
            "positive": sum(f["rating"] == 1 for f in feedback),
            "negative": sum(f["rating"] == -1 for f in feedback),
            "render_failures": 0,
            "repaired": 0,
            "attempts": 1,
            "latency_ms": 4000,
        },
        "metadata": {
            "model": "openai/gpt-oss-120b",
            "conversation_id": "conv-1",
            "version": 1,
            "created_at": "2026-09-30T09:00:00.000Z",
            "feedback": feedback,
        },
    }


def ndjson(*lines: dict) -> str:
    return "".join(json.dumps(line) + "\n" for line in lines)


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    for key in ("WANDB_API_KEY", "GROQ_API_KEY", "TRAINING_API_TOKEN", "API_URL", "KROKI_URL"):
        monkeypatch.delenv(key, raising=False)
    return Settings(
        _env_file=None,
        API_URL=API,
        KROKI_URL=KROKI,
        TRAINING_API_TOKEN="t" * 40,
        WANDB_API_KEY="wandb-test",
        GROQ_API_KEY="groq-test",
    )
