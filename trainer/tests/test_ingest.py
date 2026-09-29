import httpx
import pytest
import respx

from uml_trainer.export_client import ExportClient, ExportFormatError
from uml_trainer.scenarios import build_rubric, build_scenarios
from uml_trainer.schemas import ExportLine

from .conftest import API, AS_OF, export_line, ndjson


@respx.mock
async def test_pull_validates_lines_and_keeps_as_of():
    route = respx.get(f"{API}/training/trajectories").mock(
        return_value=httpx.Response(200, text=ndjson(export_line("a"), export_line("b")), headers={"X-Export-As-Of": AS_OF})
    )
    client = ExportClient(API, "secret-token")

    as_of, lines = await client.pull(50)

    assert as_of == AS_OF
    assert [line.id for line in lines] == ["a", "b"]
    assert route.calls[0].request.headers["authorization"] == "Bearer secret-token"
    assert route.calls[0].request.url.params["limit"] == "50"


@respx.mock
async def test_pull_names_the_malformed_line():
    bad = export_line("b")
    bad["unexpected"] = True
    respx.get(f"{API}/training/trajectories").mock(
        return_value=httpx.Response(200, text=ndjson(export_line("a"), bad), headers={"X-Export-As-Of": AS_OF})
    )

    with pytest.raises(ExportFormatError, match="line 2"):
        await ExportClient(API, "t").pull(10)


@respx.mock
async def test_ack_echoes_ids_and_as_of():
    route = respx.post(f"{API}/training/trajectories/ack").mock(return_value=httpx.Response(200, json={"acknowledged": 2}))

    assert await ExportClient(API, "t").ack(["a", "b"], AS_OF) == 2
    assert route.calls[0].request.content == b'{"ids":["a","b"],"as_of":"2026-09-30T10:00:00.123456Z"}'


def lines(*raw: dict) -> list[ExportLine]:
    return [ExportLine.model_validate(r) for r in raw]


def test_scenarios_put_the_most_negative_feedback_first_and_cap():
    scenarios = build_scenarios(
        lines(export_line("pos", 1.0), export_line("neg", -0.5), export_line("zero", 0.0)), max_scenarios=2
    )
    assert [s.id for s in scenarios] == ["neg", "zero"]


def test_scenario_types_come_from_the_last_requested_listing():
    raw = export_line("u", types=("sequence",))
    raw["messages_and_choices"][1]["content"] = (
        "Previous requirements:\nold\n\nRequested diagram types:\n- class: engine=mermaid\n\n"
        "New requirements:\nadd alerts\n\nRequested diagram types:\n- sequence: engine=mermaid\n- component: engine=plantuml"
    )
    (scenario,) = build_scenarios(lines(raw), 8)
    assert scenario.requested_types == ("sequence", "component")


def test_rubric_carries_user_feedback_verbatim():
    (scenario,) = build_scenarios(lines(export_line()), 8)
    rubric = build_rubric(scenario)
    assert "component diagram: 👎 not helpful" in rubric
    assert '"missing SEBI fetcher"' in rubric
