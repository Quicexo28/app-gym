from fastapi import APIRouter

from app.api.v1.routes import meta

api_router = APIRouter()
api_router.include_router(meta.router, prefix="/meta", tags=["meta"])
