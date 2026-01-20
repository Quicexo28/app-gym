from __future__ import annotations

import uuid
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.db.engine import get_db
from app.db.models import Run
from app.db.repo import list_sessions_for_athlete
from coach_ai.e2e import EndToEndConfig, run_end_to_end
from coach_ai.e2e.versioning import ENGINE_VERSION, fingerprint_config

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("/{athlete_id}")
def run_pipeline_for_athlete(
    athlete_id: str,
    db: DbSession,
    metric_key: str = "volume_load_kg",
    use_normalized: bool = True,
) -> dict:
    sessions = list_sessions_for_athlete(db, athlete_id)
    if not sessions:
        raise HTTPException(status_code=404, detail="No sessions found for athlete.")

    cfg = EndToEndConfig(
        athlete_id=athlete_id,
        metric_key=metric_key,
        use_normalized=use_normalized,
        normalizer_min_n=10,
        clip_z=5.0,
        log_enabled=False,  # DB es la fuente de verdad aquí
    )

    res = run_end_to_end(sessions, config=cfg)

    cfg_dict = asdict(cfg)
    fp = fingerprint_config(cfg_dict)

    row = Run(
        athlete_id=athlete_id,
        engine_version=ENGINE_VERSION,
        config_fingerprint=fp,
        metric_key=metric_key,
        used_normalized=use_normalized,
        config=jsonable_encoder(cfg_dict),
        summary=jsonable_encoder(res.summary),
        trend=jsonable_encoder(res.trend),
        latents=jsonable_encoder(res.latents),
        suggestions=jsonable_encoder(res.suggestions),
        issues=jsonable_encoder([i.model_dump() for i in res.issues]),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {"run_id": str(row.run_id), "summary": row.summary}


@router.get("/{run_id}")
def get_run(run_id: str, db: DbSession) -> dict:
    try:
        rid = uuid.UUID(run_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail="Invalid run_id UUID.") from err

    row = db.get(Run, rid)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found.")

    return {
        "run_id": str(row.run_id),
        "athlete_id": row.athlete_id,
        "generated_at_utc": row.generated_at_utc.isoformat(),
        "engine_version": row.engine_version,
        "config_fingerprint": row.config_fingerprint,
        "config": row.config,
        "summary": row.summary,
        "trend": row.trend,
        "latents": row.latents,
        "suggestions": row.suggestions,
        "issues": row.issues,
    }


@router.get("/{run_id}/summary")
def get_run_summary(run_id: str, db: DbSession) -> dict:
    """Coach-friendly view: top 3 scenarios + last latent state + issue counts.

    This endpoint is meant for UX consumption (MVP).
    It does not prescribe actions, only surfaces probabilistic scenarios and uncertainty.
    """
    from collections import Counter

    try:
        rid = uuid.UUID(run_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail="Invalid run_id UUID.") from err

    row = db.get(Run, rid)
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found.")

    suggestions = row.suggestions or {}
    scenarios = suggestions.get("scenarios", []) if isinstance(suggestions, dict) else []

    top3 = [
        {
            "name": s.get("name"),
            "probability": s.get("probability"),
            "confidence": s.get("confidence"),
            "title": s.get("title"),
            "tradeoffs": s.get("tradeoffs"),
            "levers": s.get("levers"),
        }
        for s in scenarios[:3]
    ]

    latents = row.latents or {}
    points = latents.get("points", []) if isinstance(latents, dict) else []
    last_point = points[-1] if points else {}

    issues = row.issues or []
    codes = [i.get("code") for i in issues if isinstance(i, dict) and "code" in i]
    issues_by_code = dict(Counter(codes))

    return {
        "run_id": str(row.run_id),
        "athlete_id": row.athlete_id,
        "generated_at_utc": row.generated_at_utc.isoformat(),
        "metric_key": row.metric_key,
        "top3_scenarios": top3,
        "last_latents": last_point.get("states", {}),
        "confidence_last": last_point.get("confidence"),
        "issues_by_code": issues_by_code,
        "summary": row.summary,
    }
