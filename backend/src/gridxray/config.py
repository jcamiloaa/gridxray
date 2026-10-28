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
    spark_reasoning_effort: str = "medium"  # low was faster but forgot arguments and lost accuracy
    wonder_reasoning_effort: str = "high"  # second-opinion reviews
    meta_infer_effort: str = "medium"  # Wonder's own topology inference, run in the background

    experiment_budget: int = 20
    max_agent_steps: int = 60
    max_wonder_reviews: int = 3

    # Postgres. In Docker the api service overrides the host to `postgres`.
    database_url: str = "postgresql+psycopg://gridxray:gridxray-local@localhost:5433/gridxray"

    # Auth: session JWT in an HttpOnly cookie. Change SECRET_KEY outside local development.
    secret_key: str = "dev-only-insecure-secret-change-me-in-prod"
    session_hours: int = 12
    cookie_secure: bool = False  # True when served over HTTPS

    # Demo account, created on startup so judges can sign in with one click.
    demo_user_email: str = "demo@gridxray.dev"
    demo_user_password: str = "gridxray-demo"
    demo_user_name: str = "Demo Engineer"


settings = Settings()
