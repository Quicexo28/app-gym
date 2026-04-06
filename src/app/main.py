from __future__ import annotations

import logging
import time
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.core.config import Settings
from app.core.logging import configure_logging
from app.db.engine import SessionLocal


def _error_payload(*, code: str, detail: str, context: dict | None = None) -> dict:
    return {
        "code": code,
        "detail": detail,
        "context": context or {},
    }


def create_app() -> FastAPI:
    settings = Settings()
    configure_logging(settings.log_level)
    logger = logging.getLogger("app.request")

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_observability(request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or str(uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            logger.exception(
                "request_failed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "latency_ms": elapsed_ms,
                },
            )
            raise

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.info(
            "request_completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "latency_ms": elapsed_ms,
            },
        )
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Response-Time-Ms"] = str(elapsed_ms)
        return response

    def build_http_error_response(status_code: int, detail_raw: object) -> JSONResponse:
        if isinstance(detail_raw, str):
            detail = detail_raw
            code = f"http_{status_code}"
            context: dict = {}
        elif isinstance(detail_raw, dict):
            detail = str(detail_raw.get("detail") or detail_raw.get("message") or f"HTTP {status_code}")
            code = str(detail_raw.get("code") or f"http_{status_code}")
            context = detail_raw.get("context") if isinstance(detail_raw.get("context"), dict) else {}
        else:
            detail = f"HTTP {status_code}"
            code = f"http_{status_code}"
            context = {}

        return JSONResponse(
            status_code=status_code,
            content=_error_payload(code=code, detail=detail, context=context),
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):
        return build_http_error_response(exc.status_code, exc.detail)

    @app.exception_handler(StarletteHTTPException)
    async def starlette_http_exception_handler(_: Request, exc: StarletteHTTPException):
        return build_http_error_response(exc.status_code, exc.detail)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                code="request_validation_error",
                detail="Payload invalido.",
                context={"errors": exc.errors()},
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content=_error_payload(
                code="internal_server_error",
                detail="Error interno del servidor.",
                context={"type": exc.__class__.__name__},
            ),
        )

    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok"}

    @app.get("/ready", tags=["meta"])
    def ready():
        migration_revision: str | None = None
        with SessionLocal() as db:
            try:
                db.execute(text("SELECT 1"))
            except SQLAlchemyError:
                return {
                    "status": "degraded",
                    "ready": False,
                    "checks": {
                        "database": False,
                        "migrations": False,
                    },
                }

            try:
                migration_revision = db.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar_one_or_none()
            except SQLAlchemyError:
                migration_revision = None

        return {
            "status": "ok",
            "ready": True,
            "checks": {
                "database": True,
                "migrations": migration_revision is not None,
            },
            "migration_revision": migration_revision,
        }

    return app


app = create_app()
