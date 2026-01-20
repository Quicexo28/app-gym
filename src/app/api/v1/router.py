from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints.meta import router as meta_router
from app.api.v1.endpoints.runs import router as runs_router
from app.api.v1.endpoints.runs_list import router as runs_list_router
from app.api.v1.endpoints.sessions import router as sessions_router

api_router = APIRouter()

# Meta endpoints (required by tests)
api_router.include_router(meta_router)

# Phase 7/8 endpoints
api_router.include_router(sessions_router)
api_router.include_router(runs_router)
api_router.include_router(runs_list_router)
