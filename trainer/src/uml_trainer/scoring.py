import asyncio
import json
import re

import art
import httpx
from pydantic import ValidationError

from .schemas import ENGINE_BY_TYPE, LlmDiagram, LlmDiagrams

_THINK = re.compile(r"^\s*<think>.*?</think>", re.DOTALL)
_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


class RendererUnavailable(Exception):
    """Kroki outage or misconfiguration. The run aborts: this must never be scored as bad output."""


def format_gate(reply: str, requested_types: tuple[str, ...]) -> list[LlmDiagram] | None:
    """The reply's diagrams in requested order, or None if it isn't exactly one diagram per requested type.

    Tolerates one leading <think> block and one surrounding ```json fence (common in chat
    models); the backend must apply the same leniency when it serves this model.
    """
    text = _THINK.sub("", reply, count=1)
    if fenced := _FENCE.match(text):
        text = fenced.group(1)
    try:
        parsed = LlmDiagrams.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError, RecursionError):
        return None
    types = [d.type for d in parsed.diagrams]
    if not requested_types or sorted(types) != sorted(requested_types):
        return None  # missing, duplicate or unrequested types
    by_type = {d.type: d for d in parsed.diagrams}
    return [by_type[t] for t in requested_types]


class KrokiRenderer:
    def __init__(self, base_url: str, client: httpx.AsyncClient | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=15)

    async def renders(self, engine: str, source: str) -> bool:
        """True if Kroki renders it, False on a syntax error (400); anything else is an outage."""
        try:
            res = await self._client.post(
                f"{self._base_url}/{engine}/svg",
                content=source.encode(),
                headers={"Content-Type": "text/plain"},
            )
        except httpx.TimeoutException:
            return False  # Kroki is reachable but this source is pathological
        except httpx.TransportError as err:
            raise RendererUnavailable(f"Kroki unreachable: {err}") from err
        if res.is_success:
            return True
        if res.status_code == 400:
            return False
        raise RendererUnavailable(f"Kroki returned {res.status_code} (check KROKI_URL / Kroki health)")

    async def aclose(self) -> None:
        await self._client.aclose()


async def render_rate(diagrams: list[LlmDiagram], renderer: KrokiRenderer) -> float:
    results = await asyncio.gather(*(renderer.renders(ENGINE_BY_TYPE[d.type], d.source) for d in diagrams))
    return sum(results) / len(results)


def combine(format_ok: bool, render: float, ruler: float) -> float:
    """reward-design.md: 0 for invalid output, else an even blend of render rate and RULER."""
    return 0.0 if not format_ok else round(0.5 * render + 0.5 * ruler, 4)


def is_trainable(group: art.TrajectoryGroup) -> bool:
    """GRPO learns from reward differences inside a group; a flat group carries no signal."""
    return len(group.trajectories) >= 2 and len({round(t.reward, 6) for t in group.trajectories}) > 1
