import httpx
import pytest
import respx

from uml_trainer import cli

from .conftest import API, AS_OF, export_line, ndjson


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no .env picked up
    monkeypatch.setenv("API_URL", API)
    monkeypatch.setenv("TRAINING_API_TOKEN", "t" * 40)


def test_missing_export_token_exits_2(monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TRAINING_API_TOKEN", raising=False)
    assert cli.main([]) == 2
    assert "TRAINING_API_TOKEN" in capsys.readouterr().err


@pytest.mark.parametrize("argv", [["--rollouts", "1"], ["--limit", "0"], ["--steps", "0"]])
def test_invalid_options_are_rejected(argv):
    with pytest.raises(SystemExit) as exit_info:
        cli.parse_args(argv)
    assert exit_info.value.code == 2


@respx.mock
def test_malformed_export_exits_2_naming_the_line(env, capsys):
    bad = export_line("b")
    bad["metadata"]["feedback"][0]["rating"] = 0
    respx.get(f"{API}/training/trajectories").mock(
        return_value=httpx.Response(200, text=ndjson(export_line("a"), bad), headers={"X-Export-As-Of": AS_OF})
    )
    assert cli.main(["--dry-run"]) == 2
    assert "line 2" in capsys.readouterr().err


@respx.mock
def test_real_run_without_wandb_key_exits_2(env, monkeypatch, capsys):
    monkeypatch.delenv("WANDB_API_KEY", raising=False)
    respx.get(f"{API}/training/trajectories").mock(
        return_value=httpx.Response(200, text=ndjson(export_line("a")), headers={"X-Export-As-Of": AS_OF})
    )
    assert cli.main([]) == 2
    assert "WANDB_API_KEY" in capsys.readouterr().err
