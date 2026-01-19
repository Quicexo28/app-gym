from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .schema import Session


class SessionMetrics(BaseModel):
    """Base derived metrics for a gym session (Phase 1).

    - srpe_load: internal load proxy (if session rpe is provided)
    - volume_load_kg: tonnage proxy computed from sets (load_kg * reps)
    """

    model_config = ConfigDict(extra="forbid")

    duration_min: float = Field(..., ge=0)
    rpe: float | None = Field(default=None)
    srpe_load: float | None = Field(default=None)

    # Gym-specific derived metrics
    volume_load_kg: float | None = Field(default=None)
    reps_total: int | None = Field(default=None)
    sets_total: int | None = Field(default=None)
    exercise_count: int = Field(default=0)


def _finite_or_none(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def compute_session_metrics(session: Session) -> SessionMetrics:
    """Compute base derived metrics for one gym session.

    Notes:
    - This function is deterministic and does not decide trustworthiness.
    - Semantic problems should be surfaced by `validate_session`.
    """

    duration = _finite_or_none(session.duration_min)
    duration = 0.0 if duration is None else max(0.0, duration)

    rpe = _finite_or_none(session.rpe) if session.rpe is not None else None
    srpe = (rpe * duration) if rpe is not None else None

    # Strength metrics from sets
    volume = 0.0
    reps_total = 0
    sets_total = 0
    has_any = False

    for ex in session.exercises:
        for st in ex.sets:
            # reps
            if not isinstance(st.reps, int) or st.reps <= 0:
                continue
            # load
            load = _finite_or_none(st.load_kg)
            if load is None or load < 0:
                continue

            volume += load * st.reps
            reps_total += st.reps
            sets_total += 1
            has_any = True

    return SessionMetrics(
        duration_min=duration,
        rpe=rpe,
        srpe_load=srpe,
        volume_load_kg=volume if has_any else None,
        reps_total=reps_total if has_any else None,
        sets_total=sets_total if has_any else None,
        exercise_count=len(session.exercises),
    )
