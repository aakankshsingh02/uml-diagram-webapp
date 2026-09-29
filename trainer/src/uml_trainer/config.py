from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# trainer/.env, regardless of the directory the CLI is started from.
PROJECT_ENV = Path(__file__).resolve().parents[2] / ".env"


class ConfigError(Exception):
    """Missing or invalid configuration; the CLI exits 2."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ENV, env_file_encoding="utf-8", extra="ignore")

    api_url: str = Field(default="http://localhost:4000/api", alias="API_URL")
    training_api_token: str = Field(default="", alias="TRAINING_API_TOKEN")
    kroki_url: str = Field(default="http://localhost:8000", alias="KROKI_URL")

    wandb_api_key: str = Field(default="", alias="WANDB_API_KEY")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")

    art_project: str = Field(default="uml-diagrams", alias="ART_PROJECT")
    art_model_name: str = Field(default="uml-diagrammer", alias="ART_MODEL_NAME")
    # ART 0.5 requires a run name; keeping it fixed continues training on the same checkpoints.
    art_run_name: str = Field(default="main", alias="ART_RUN_NAME")
    art_base_model: str = Field(default="OpenPipe/Qwen3-14B-Instruct", alias="ART_BASE_MODEL")
    ruler_judge_model: str = Field(default="groq/openai/gpt-oss-120b", alias="RULER_JUDGE_MODEL")

    @property
    def judge_uses_groq(self) -> bool:
        return self.ruler_judge_model.startswith("groq/")

    def require_for_export(self) -> None:
        if not self.training_api_token:
            raise ConfigError("TRAINING_API_TOKEN is not set (must match the backend's)")

    def require_for_training(self) -> None:
        """Paid runs need the W&B key (serverless training) and a key for the RULER judge.

        Non-Groq judges read their provider key from the process environment (LiteLLM).
        """
        self.require_for_export()
        if not self.wandb_api_key:
            raise ConfigError("WANDB_API_KEY is not set")
        if self.judge_uses_groq and not self.groq_api_key:
            raise ConfigError("GROQ_API_KEY is not set (needed by the RULER judge)")
