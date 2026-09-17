from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.athletes import router as athletes_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.body_metrics import router as body_metrics_router
from app.api.v1.endpoints.coach_athletes import router as coach_athletes_router
from app.api.v1.endpoints.coach_billing import router as coach_billing_router
from app.api.v1.endpoints.coach_invite import router as coach_invite_router
from app.api.v1.endpoints.coach_notes import router as coach_notes_router
from app.api.v1.endpoints.coach_reports import router as coach_reports_router
from app.api.v1.endpoints.coach_routines import router as coach_routines_router
from app.api.v1.endpoints.diet import router as diet_router
from app.api.v1.endpoints.exercises_catalog import router as exercises_catalog_router
from app.api.v1.endpoints.me import router as me_router
from app.api.v1.endpoints.meta import router as meta_router
from app.api.v1.endpoints.planning import router as planning_router
from app.api.v1.endpoints.profile import router as profile_router
from app.api.v1.endpoints.progress import router as progress_router
from app.api.v1.endpoints.routines_store import router as routines_store_router
from app.api.v1.endpoints.runs import router as runs_router
from app.api.v1.endpoints.runs_list import router as runs_list_router
from app.api.v1.endpoints.sessions import router as sessions_router
from app.api.v1.endpoints.settings import router as settings_router
from app.api.v1.endpoints.webhooks import router as webhooks_router

# IMPORTANTE: SIN prefix aquí. El prefix lo pone app.main al incluir este router.
api_router = APIRouter()

api_router.include_router(meta_router)
api_router.include_router(auth_router)
api_router.include_router(me_router)
api_router.include_router(athletes_router)
api_router.include_router(body_metrics_router)
api_router.include_router(profile_router)
api_router.include_router(progress_router)
api_router.include_router(settings_router)
api_router.include_router(exercises_catalog_router)
api_router.include_router(planning_router)
api_router.include_router(routines_store_router)
api_router.include_router(coach_athletes_router)
api_router.include_router(coach_notes_router)
api_router.include_router(coach_reports_router)
api_router.include_router(coach_routines_router)
api_router.include_router(coach_invite_router)
api_router.include_router(coach_billing_router)
api_router.include_router(diet_router)

api_router.include_router(sessions_router)
api_router.include_router(runs_router)
api_router.include_router(runs_list_router)

api_router.include_router(admin_router)
api_router.include_router(webhooks_router)
