from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/ping")
def ping() -> dict:
    # Required by tests: must be exactly {"pong": True}
    return {"pong": True}


@router.get("/time")
def time() -> dict:
    return {"utc": datetime.now(UTC).isoformat()}
