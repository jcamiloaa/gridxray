from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables or `.env`."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    # Meta Model API (OpenAI-compatible). Docs: https://dev.meta.ai/docs/models
    meta_api_base_url: str = "https://api.meta.ai/v1"
    meta_api_key: str = Field("", validation_alias=AliasChoices("META_API_KEY", "MODEL_API_KEY"))
    spark_model: str = "muse-spark-1.3"  # lead investigator: tight tool loops
    wonder_model: str = "muse-wonder-1.0"  # second-opinion reviewer: deeper reasoning
    spark_reasoning_effort: str = "medium"
    wonder_reasoning_effort: str = "high"

    experiment_budget: int = 20
    max_agent_steps: int = 60
    max_wonder_reviews: int = 3
    database_path: str = "gridxray.db"


settings = Settings()
