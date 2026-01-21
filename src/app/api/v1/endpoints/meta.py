from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/ping")
def ping() -> dict:
    return {"pong": True}
