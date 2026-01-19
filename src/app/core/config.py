from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Coach AI Engineer"
    env: str = "dev"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
