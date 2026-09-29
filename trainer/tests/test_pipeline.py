import asyncio
from dataclasses import dataclass, field

import art
import httpx
import pytest
import respx

import uml_trainer.rollout as rollout_module
from uml_trainer import pipeline
from uml_trainer.config import ConfigError
from uml_trainer.export_client import ExportClient
from uml_trainer.pipeline import RunOptions, run
from uml_trainer.scoring import KrokiRenderer, RendererUnavailable

from .conftest import API, AS_OF, KROKI, export_line, ndjson, reply


@dataclass
class FakeResult:
    step: int = 1
    metrics: dict = field(default_factory=lambda: {"loss": 0.1})


class FakeBackend:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.trained: list = []

    async def train(self, model, groups, learning_rate):
        if self.fail:
            raise RuntimeError("W&B unavailable")
        self.trained.append(list(groups))
        return FakeResult()


class FakeModel:
    inference_base_url = "https://inference.test/v1"

    def __init__(self, **kwargs) -> None:
        self.kwargs = kwargs

    async def register(self, backend) -> None:
        self.backend = backend

    async def log(self, *args, **kwargs) -> None:
        pass

    def get_inference_name(self) -> str:
        return "uml-diagrammer@1"


@pytest.fixture
def api():
    with respx.mock(assert_all_called=False) as mock:
        mock.mermaid = mock.post(f"{KROKI}/mermaid/svg").mock(return_value=httpx.Response(200, text="<svg/>"))
        mock.post(f"{KROKI}/plantuml/svg").mock(return_value=httpx.Response(200, text="<svg/>"))
        mock.ack = mock.post(f"{API}/training/trajectories/ack").mock(
            return_value=httpx.Response(200, json={"acknowledged": 2})
        )
        yield mock


def serve_export(api, *lines):
    api.get(f"{API}/training/trajectories").mock(
        return_value=httpx.Response(200, text=ndjson(*lines), headers={"X-Export-As-Of": AS_OF})
    )


@pytest.fixture
def fake_art(monkeypatch):
    """Rollouts alternate a valid and a broken reply so every group has reward variance."""

    def fake_rollout_group(model, scenario, n):
        async def group():
            replies = [reply(*scenario.requested_types) if i % 2 == 0 else "not json" for i in range(n)]
            return art.TrajectoryGroup([art.Trajectory(metadata={"reply": r}) for r in replies])

        return group()

    async def fake_gather(groups, **kwargs):
        return list(await asyncio.gather(*groups))

    monkeypatch.setattr(rollout_module, "rollout_group", fake_rollout_group)
    monkeypatch.setattr(pipeline.art, "TrainableModel", FakeModel)
    monkeypatch.setattr(pipeline.art, "gather_trajectory_groups", fake_gather)


async def fake_judge(group, rubric):
    for t in group.trajectories:
        t.metrics["ruler_score"] = 0.8
    return group


def clients(settings):
    return {"export": ExportClient(API, settings.training_api_token), "renderer": KrokiRenderer(KROKI)}


async def test_empty_export_does_nothing(settings, api):
    serve_export(api)
    report = await run(settings, RunOptions(), **clients(settings), log=lambda _: None)
    assert report.message.startswith("nothing to train")
    assert not api.ack.called


async def test_dry_run_scores_fixtures_without_paid_calls_or_ack(settings, api):
    serve_export(api, export_line("a"))
    logged: list[str] = []

    def backend_must_not_be_built():
        raise AssertionError("dry run must not create a training backend")

    report = await run(
        settings, RunOptions(dry_run=True), **clients(settings), make_backend=backend_must_not_be_built, log=logged.append
    )

    assert report.scenarios == 1
    assert not api.ack.called
    assert any("0.500, 0.000" in line for line in logged)  # exported reply renders fully; broken scores 0
    assert any("missing SEBI fetcher" in line for line in logged)


async def test_successful_step_acks_every_pulled_id_once(settings, api, fake_art):
    serve_export(api, export_line("a", -0.5), export_line("b", 1.0))
    backend = FakeBackend()

    report = await run(
        settings, RunOptions(steps=2, rollouts=2), **clients(settings), judge=fake_judge, make_backend=lambda: backend, log=lambda _: None
    )

    assert len(backend.trained) == 2
    rewards = [t.reward for t in backend.trained[0][0].trajectories]
    assert rewards == [0.9, 0.0]  # 0.5*1.0 + 0.5*0.8, and the format-gate failure
    assert api.ack.call_count == 1
    assert api.ack.calls[0].request.content == b'{"ids":["a","b"],"as_of":"2026-09-30T10:00:00.123456Z"}'
    assert report.inference_model == "uml-diagrammer@1"
    assert report.inference_base_url == "https://inference.test/v1"


async def test_failed_training_never_acks(settings, api, fake_art):
    serve_export(api, export_line("a"))

    with pytest.raises(RuntimeError, match="W&B unavailable"):
        await run(settings, RunOptions(), **clients(settings), judge=fake_judge, make_backend=lambda: FakeBackend(fail=True), log=lambda _: None)
    assert not api.ack.called


async def test_nothing_trainable_skips_training_and_ack(settings, api, fake_art):
    serve_export(api, export_line("a"))
    backend = FakeBackend()

    async def failing_judge(group, rubric):
        return None  # RULER failed -> group dropped

    report = await run(settings, RunOptions(), **clients(settings), judge=failing_judge, make_backend=lambda: backend, log=lambda _: None)

    assert report.message.startswith("no trainable groups")
    assert backend.trained == []
    assert not api.ack.called


async def test_renderer_outage_aborts_without_ack(settings, api, fake_art):
    serve_export(api, export_line("a"))
    api.mermaid.mock(side_effect=httpx.ConnectError("refused"))

    with pytest.raises(RendererUnavailable):
        await run(settings, RunOptions(), **clients(settings), judge=fake_judge, make_backend=FakeBackend, log=lambda _: None)
    assert not api.ack.called


async def test_real_run_requires_wandb_key(settings, api):
    serve_export(api, export_line("a"))
    settings.wandb_api_key = ""

    with pytest.raises(ConfigError, match="WANDB_API_KEY"):
        await run(settings, RunOptions(), **clients(settings), log=lambda _: None)
    assert not api.ack.called
