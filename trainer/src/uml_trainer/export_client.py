import json

import httpx
from pydantic import ValidationError

from .config import ConfigError
from .schemas import ExportLine


class ExportFormatError(Exception):
    """An export line failed strict validation; the CLI exits 2."""


def _check(res: httpx.Response) -> None:
    if res.status_code in (401, 403):
        raise ConfigError(f"TRAINING_API_TOKEN was rejected by the backend ({res.status_code})")
    res.raise_for_status()


class ExportClient:
    """Pull/ack client for the backend's token-protected trajectory export."""

    def __init__(self, api_url: str, token: str, client: httpx.AsyncClient | None = None) -> None:
        self._api_url = api_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}
        self._client = client or httpx.AsyncClient(timeout=30)

    async def pull(self, limit: int) -> tuple[str, list[ExportLine]]:
        """Returns the export's X-Export-As-Of (echo it on ack) and the validated lines."""
        res = await self._client.get(
            f"{self._api_url}/training/trajectories", params={"limit": limit}, headers=self._headers
        )
        _check(res)
        as_of = res.headers.get("x-export-as-of")
        if not as_of:
            raise ExportFormatError("export response has no X-Export-As-Of header")

        lines: list[ExportLine] = []
        # NDJSON is split on "\n" only: str.splitlines() would also break on U+2028/U+0085,
        # which JSON.stringify leaves unescaped inside user comments.
        for number, raw in enumerate(res.text.split("\n"), start=1):
            if not raw.strip():
                continue
            try:
                lines.append(ExportLine.model_validate(json.loads(raw)))
            except (json.JSONDecodeError, ValidationError) as err:
                raise ExportFormatError(f"export line {number} is invalid: {err}") from err
        return as_of, lines

    async def ack(self, ids: list[str], as_of: str) -> int:
        res = await self._client.post(
            f"{self._api_url}/training/trajectories/ack",
            json={"ids": ids, "as_of": as_of},
            headers=self._headers,
        )
        _check(res)
        return int(res.json()["acknowledged"])

    async def aclose(self) -> None:
        await self._client.aclose()
