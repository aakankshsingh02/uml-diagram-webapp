import art
import httpx
import pytest
import respx

from uml_trainer.scoring import KrokiRenderer, RendererUnavailable, combine, format_gate, is_trainable, render_rate

from .conftest import KROKI, reply

TYPES = ("sequence", "component")


def test_format_gate_accepts_valid_output_in_requested_order():
    diagrams = format_gate(reply("component", "sequence"), TYPES)
    assert diagrams is not None
    assert [d.type for d in diagrams] == ["sequence", "component"]


@pytest.mark.parametrize(
    "text",
    [
        "not json",
        reply("sequence"),  # missing a requested type
        '{"diagrams": [{"type": "sequence", "title": "t", "source": "s", "extra": 1}]}',  # unknown key
        '{"diagrams": []}',
    ],
)
def test_format_gate_rejects_invalid_output(text):
    assert format_gate(text, TYPES) is None


def test_format_gate_tolerates_think_block_and_code_fence():
    text = "<think>plan the diagrams</think>\n```json\n" + reply(*TYPES) + "\n```"
    assert format_gate(text, TYPES) is not None


@respx.mock
async def test_render_rate_counts_kroki_400_as_failure():
    respx.post(f"{KROKI}/mermaid/svg").mock(return_value=httpx.Response(200, text="<svg/>"))
    respx.post(f"{KROKI}/plantuml/svg").mock(return_value=httpx.Response(400, text="syntax error"))
    diagrams = format_gate(reply(*TYPES), TYPES)

    assert await render_rate(diagrams, KrokiRenderer(KROKI)) == 0.5


@respx.mock
@pytest.mark.parametrize("response", [httpx.Response(503), httpx.ConnectError("refused")])
async def test_renderer_outage_raises_instead_of_scoring(response):
    route = respx.post(f"{KROKI}/mermaid/svg")
    if isinstance(response, Exception):
        route.mock(side_effect=response)
    else:
        route.mock(return_value=response)

    with pytest.raises(RendererUnavailable):
        await KrokiRenderer(KROKI).renders("mermaid", "graph TD; A-->B")


def test_combine_matches_reward_design():
    assert combine(True, 0.5, 0.8) == 0.65
    assert combine(False, 1.0, 1.0) == 0.0


def test_flat_groups_are_not_trainable():
    flat = art.TrajectoryGroup([art.Trajectory(reward=0.5), art.Trajectory(reward=0.5)])
    varied = art.TrajectoryGroup([art.Trajectory(reward=0.5), art.Trajectory(reward=0.0)])
    assert not is_trainable(flat)
    assert is_trainable(varied)
