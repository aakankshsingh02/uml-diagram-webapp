import argparse
import asyncio
import sys

from .config import ConfigError, Settings
from .export_client import ExportClient, ExportFormatError
from .pipeline import RunOptions, run
from .scoring import KrokiRenderer

EXIT_OK, EXIT_RUNTIME, EXIT_CONFIG = 0, 1, 2


def parse_args(argv: list[str] | None = None) -> RunOptions:
    p = argparse.ArgumentParser(prog="uml-trainer", description="Train the UML model on user feedback with ART.")
    p.add_argument("--dry-run", action="store_true", help="score fixtures only; no W&B, RULER or ack calls")
    p.add_argument("--steps", type=int, default=1)
    p.add_argument("--rollouts", type=int, default=4, help="rollouts per scenario (min 2)")
    p.add_argument("--max-scenarios", type=int, default=8)
    p.add_argument("--limit", type=int, default=100, help="export lines to pull (max 1000)")
    p.add_argument("--learning-rate", type=float, default=1e-5)
    a = p.parse_args(argv)
    if a.rollouts < 2:
        p.error("--rollouts must be at least 2 (GRPO compares rollouts within a group)")
    if not 1 <= a.limit <= 1000:
        p.error("--limit must be between 1 and 1000")
    if a.steps < 1 or a.max_scenarios < 1:
        p.error("--steps and --max-scenarios must be at least 1")
    if not (0 < a.learning_rate < 1):  # also rejects nan
        p.error("--learning-rate must be between 0 and 1")
    return RunOptions(
        dry_run=a.dry_run,
        steps=a.steps,
        rollouts=a.rollouts,
        max_scenarios=a.max_scenarios,
        limit=a.limit,
        learning_rate=a.learning_rate,
    )


async def _main(options: RunOptions, settings: Settings) -> int:
    export = ExportClient(settings.api_url, settings.training_api_token)
    renderer = KrokiRenderer(settings.kroki_url)
    try:
        report = await run(settings, options, export=export, renderer=renderer)
    except (ConfigError, ExportFormatError) as err:
        print(f"error: {err}", file=sys.stderr)
        return EXIT_CONFIG
    except Exception as err:  # noqa: BLE001 - any failure must exit non-zero without acking
        print(f"error: {type(err).__name__}: {err}", file=sys.stderr)
        return EXIT_RUNTIME
    finally:
        await export.aclose()
        await renderer.aclose()

    for warning in report.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    print(report.message)
    if report.inference_model:
        print(f"inference base URL: {report.inference_base_url}")
        print(f"inference model:    {report.inference_model}")
        print(f"step: {report.step}  acknowledged: {report.acknowledged}")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    settings = Settings()
    try:
        settings.require_for_export()
    except ConfigError as err:
        print(f"error: {err}", file=sys.stderr)
        return EXIT_CONFIG
    return asyncio.run(_main(options, settings))
