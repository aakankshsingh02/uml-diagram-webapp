from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import art

from .config import Settings
from .export_client import ExportClient
from .scenarios import Scenario, build_rubric, build_scenarios
from .scoring import KrokiRenderer, combine, format_gate, is_trainable, render_rate

# RULER signature subset used here; injectable so tests and dry runs never call a judge.
Judge = Callable[[art.TrajectoryGroup, str], Awaitable[art.TrajectoryGroup | None]]

# Tolerate a quarter of rollouts failing (inference errors, timeouts) before a step aborts.
ROLLOUT_FAILURE_TOLERANCE = 0.25


class JudgeUnavailable(Exception):
    """Every group failed RULER judging: a key/model/provider problem, not a data problem."""


@dataclass
class RunOptions:
    dry_run: bool = False
    steps: int = 1
    rollouts: int = 4
    max_scenarios: int = 8
    limit: int = 100
    learning_rate: float = 1e-5


@dataclass
class RunReport:
    pulled: int = 0
    scenarios: int = 0
    skipped: list[str] = field(default_factory=list)
    trained_groups: int = 0
    acknowledged: int = 0
    step: int | None = None
    inference_base_url: str | None = None
    inference_model: str | None = None
    warnings: list[str] = field(default_factory=list)
    message: str = ""


def ruler_judge(settings: Settings) -> Judge:
    async def judge(group: art.TrajectoryGroup, rubric: str) -> art.TrajectoryGroup | None:
        from art.rewards import ruler_score_group

        # LiteLLM reads provider keys from os.environ; the Groq key comes from .env, so pass it
        # explicitly, and only to a Groq judge (never leak it to another provider).
        params = {"api_key": settings.groq_api_key} if settings.judge_uses_groq and settings.groq_api_key else None
        return await ruler_score_group(
            group,
            settings.ruler_judge_model,
            extra_litellm_params=params,
            rubric=rubric,
            swallow_exceptions=True,
        )

    return judge


async def score_group(
    group: art.TrajectoryGroup, scenario: Scenario, renderer: KrokiRenderer, judge: Judge | None
) -> art.TrajectoryGroup | None:
    """Format gate → Kroki render rate → RULER (relative, feedback-informed) → combined reward.

    Returns None when the judge fails (the group is dropped, never trained on half-scored).
    """
    parts: list[tuple[bool, float]] = []
    for traj in group.trajectories:
        diagrams = format_gate(str(traj.metadata.get("reply", "")), scenario.requested_types)
        render = await render_rate(diagrams, renderer) if diagrams else 0.0
        parts.append((diagrams is not None, render))

    ruler_scores = [0.0] * len(parts)
    if judge is not None:
        judged = await judge(group, build_rubric(scenario))
        if judged is None:
            return None
        group = judged
        ruler_scores = [float(t.metrics.get("ruler_score", t.reward)) for t in group.trajectories]

    for traj, (format_ok, render), ruler in zip(group.trajectories, parts, ruler_scores, strict=True):
        traj.reward = combine(format_ok, render, ruler)
        traj.metrics.update(
            format_ok=format_ok, render_rate=render, ruler=ruler, human_reward=scenario.human_reward
        )
    return group


def fixture_group(scenario: Scenario) -> art.TrajectoryGroup:
    """Dry-run stand-in for rollouts: the exported reply plus a deliberately broken variant."""
    return art.TrajectoryGroup(
        [
            art.Trajectory(metadata={"scenario_id": scenario.id, "reply": scenario.exported_reply}),
            art.Trajectory(metadata={"scenario_id": scenario.id, "reply": "not json"}),
        ]
    )


async def run(
    settings: Settings,
    options: RunOptions,
    *,
    export: ExportClient,
    renderer: KrokiRenderer,
    judge: Judge | None = None,
    make_backend: Callable[[], object] | None = None,
    log: Callable[[str], None] = print,
) -> RunReport:
    report = RunReport()
    as_of, lines = await export.pull(options.limit)
    report.pulled = len(lines)
    if not lines:
        report.message = "nothing to train: the export is empty"
        return report

    scenarios, report.skipped = build_scenarios(lines, options.max_scenarios)
    report.scenarios = len(scenarios)
    for skipped_id in report.skipped:
        log(f"skipped {skipped_id}: no 'Requested diagram types' listing in its prompt (left in the export)")
    for s in scenarios:
        log(f"scenario {s.id} human_reward={s.human_reward:+.3f} types={','.join(s.requested_types)}")
    if not scenarios:
        report.message = "nothing to train: no usable scenarios"
        return report

    if options.dry_run:
        for s in scenarios:
            scored = await score_group(fixture_group(s), s, renderer, judge=None)
            if scored is None:  # unreachable without a judge; explicit rather than assert
                continue
            rewards = ", ".join(f"{t.reward:.3f}" for t in scored.trajectories)
            log(f"  dry-run fixture rewards (exported reply, broken): {rewards}")
            log("  rubric:\n    " + build_rubric(s).replace("\n", "\n    "))
        report.message = "dry run: no rollouts, training or ack performed"
        return report

    settings.require_for_training()
    if make_backend is None:
        from art.serverless.backend import ServerlessBackend

        def make_backend() -> object:
            return ServerlessBackend(api_key=settings.wandb_api_key)

    backend = make_backend()
    model = art.TrainableModel(
        name=settings.art_model_name,
        project=settings.art_project,
        run_name=settings.art_run_name,
        base_model=settings.art_base_model,
    )
    await model.register(backend)  # type: ignore[arg-type]
    judge = judge or ruler_judge(settings)

    from .rollout import has_trainable_choice, rollout_group

    acked: set[str] = set()
    for step in range(options.steps):
        label = f"step {step + 1}/{options.steps}"
        try:
            groups = await art.gather_trajectory_groups(
                (rollout_group(model, s, options.rollouts) for s in scenarios),
                pbar_desc=f"rollouts ({label})",
                max_exceptions=ROLLOUT_FAILURE_TOLERANCE,
            )

            trained: list[art.TrajectoryGroup] = []
            processed: set[str] = set()  # rolled out and scored: trained, or flat (tried, no signal)
            judge_failures = 0
            for group, scenario in zip(groups, scenarios, strict=True):
                group.trajectories = [t for t in group.trajectories if has_trainable_choice(t)]
                if len(group.trajectories) < 2:
                    log(f"  {scenario.id}: fewer than 2 usable rollouts, left for the next run")
                    continue
                result = await score_group(group, scenario, renderer, judge)
                if result is None:
                    judge_failures += 1
                    log(f"  {scenario.id}: RULER judging failed, left for the next run")
                    continue
                processed.add(scenario.id)
                if is_trainable(result):
                    trained.append(result)

            if judge_failures and judge_failures == len(scenarios):
                raise JudgeUnavailable(
                    f"RULER failed for every group (judge {settings.ruler_judge_model}); check its key and model"
                )
            if not trained:
                if acked:
                    break  # an earlier step already trained; keep its result
                report.message = "no trainable groups (all flat or unusable); nothing acked"
                return report

            result = await backend.train(model, trained, learning_rate=options.learning_rate)  # type: ignore[attr-defined]
            report.trained_groups += len(trained)
            report.step = result.step

            # Ack right after training, before logging: the checkpoint now reflects this data.
            to_ack = sorted(processed - acked)
            if to_ack:
                count = await export.ack(to_ack, as_of)
                report.acknowledged += count
                acked.update(to_ack)
                if count != len(to_ack):
                    report.warnings.append(f"backend acknowledged {count} of {len(to_ack)} ids")

            try:
                await model.log(trained, metrics=result.metrics, step=result.step, split="train")
            except Exception as err:  # noqa: BLE001 - metrics are best-effort; training and ack succeeded
                report.warnings.append(f"W&B metrics logging failed at {label}: {err}")
        except Exception as err:
            if not acked:
                raise
            raise RuntimeError(
                f"{label} failed after earlier steps trained and acked {len(acked)} id(s) "
                f"(checkpoint step {report.step}): {err}"
            ) from err

    report.inference_base_url = model.inference_base_url
    report.inference_model = model.get_inference_name()
    report.message = f"trained {report.trained_groups} group(s) to step {report.step}"
    return report
