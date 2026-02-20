from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Coach AI Engineer"
    env: str = "dev"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://coach:coach@localhost:5432/coach_ai"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    google_client_id: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
