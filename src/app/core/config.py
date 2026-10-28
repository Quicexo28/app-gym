from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Alzo"
    env: str = "dev"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://coach:coach@localhost:5432/coach_ai"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # webview de Capacitor (app Android/iOS)
        "https://localhost",
        "capacitor://localhost",
    ]
    # Dev en LAN: cualquier IP privada (probar desde el movil en la misma red).
    cors_origin_regex: str | None = (
        r"https?://(192\.168\.\d{1,3}\.\d{1,3}"
        r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?"
    )
    google_client_id: str | None = None
    # Client ID OAuth tipo "iOS": en la app iOS el idToken de Google trae este `aud`.
    google_ios_client_id: str | None = None

    # Sign in with Apple: `aud` aceptados en el identity token (bundle ID de la app iOS
    # y, si algun dia hay login web, el Services ID). En env va como JSON.
    apple_client_ids: list[str] = ["com.santiagoquiceno.alzo"]
    # Opcionales: canjear el authorization_code por refresh_token y revocarlo al borrar
    # la cuenta (exigido por Apple). APPLE_PRIVATE_KEY es el .p8 (PEM; admite "\n").
    apple_team_id: str | None = None
    apple_key_id: str | None = None
    apple_private_key: str | None = None

    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_price_coach_plan: str | None = None
    stripe_price_extra_seat: str | None = None
    coach_included_seats: int = 15
    public_web_url: str = "http://localhost:5173"

    # Raiz en disco para archivos subidos por usuarios (hoy: fotos de empaques
    # de alimentos). Montada como volumen `coach_ai_media` en docker-compose.
    media_root: str = "/app/media"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
