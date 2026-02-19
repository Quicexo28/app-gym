from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.athletes import router as athletes_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.exercises_catalog import router as exercises_catalog_router
from app.api.v1.endpoints.me import router as me_router
from app.api.v1.endpoints.meta import router as meta_router
from app.api.v1.endpoints.planning import router as planning_router
from app.api.v1.endpoints.profile import router as profile_router
from app.api.v1.endpoints.runs import router as runs_router
from app.api.v1.endpoints.runs_list import router as runs_list_router
from app.api.v1.endpoints.sessions import router as sessions_router
from app.api.v1.endpoints.settings import router as settings_router
from app.api.v1.endpoints.view_mode import router as view_mode_router

# IMPORTANTE: SIN prefix aquí. El prefix lo pone app.main al incluir este router.
api_router = APIRouter()

api_router.include_router(meta_router)
api_router.include_router(auth_router)
api_router.include_router(me_router)
api_router.include_router(view_mode_router)
api_router.include_router(athletes_router)
api_router.include_router(profile_router)
api_router.include_router(settings_router)
api_router.include_router(exercises_catalog_router)
api_router.include_router(planning_router)

api_router.include_router(sessions_router)
api_router.include_router(runs_router)
api_router.include_router(runs_list_router)

api_router.include_router(admin_router)
