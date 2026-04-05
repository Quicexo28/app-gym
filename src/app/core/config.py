import json

from pydantic import field_validator
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

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if value is None:
            return [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ]

        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]

        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []

            # Allow JSON array in env: CORS_ORIGINS=["https://app.example.com"]
            if raw.startswith("["):
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        return [str(item).strip() for item in parsed if str(item).strip()]
                except json.JSONDecodeError:
                    pass

            # Allow CSV in env: CORS_ORIGINS=https://app.example.com,https://admin.example.com
            return [part.strip() for part in raw.split(",") if part.strip()]

        return value

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
