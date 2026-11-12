from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.auth.security import assert_secret_is_safe
from app.core.config import Settings
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    settings = Settings()
    configure_logging(settings.log_level)
    assert_secret_is_safe(settings.env)

    is_dev = settings.env.strip().lower() != "prod"
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if is_dev else None,
        redoc_url="/redoc" if is_dev else None,
        openapi_url="/openapi.json" if is_dev else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-App-Admin-View", "X-App-Coach-View"],
    )

    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok"}

    return app


app = create_app()
