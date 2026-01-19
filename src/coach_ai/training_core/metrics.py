from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .schema import Session


class SessionMetrics(BaseModel):
    """Base derived metrics for a session.

    This layer is intentionally small. Anything that resembles trend detection or
    latent-state inference belongs to later phases.

    `srpe_load` is defined as:
        srpe_load = rpe * duration_min
    """

    model_config = ConfigDict(extra="forbid")

    duration_min: float = Field(..., ge=0)
    rpe: float | None = Field(default=None)
    srpe_load: float | None = Field(default=None)
    external_load_total: float | None = Field(
        default=None,
        description="Sum of external_load values (only numeric finite values).",
    )
    external_load: dict[str, float] = Field(default_factory=dict)


def _finite_or_none(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def compute_session_metrics(session: Session) -> SessionMetrics:
    """Compute base derived metrics for one session.

    This function is deterministic but *does not* decide whether the inputs are
    trustworthy. Use `validate_session` to surface uncertainty.

    Returns:
        SessionMetrics
    """

    duration = _finite_or_none(session.duration_min)
    # duration should exist by schema; if it becomes non-finite, treat as 0 in metrics layer.
    duration = 0.0 if duration is None else max(0.0, duration)

    rpe = _finite_or_none(session.rpe) if session.rpe is not None else None

    srpe = None
    if rpe is not None:
        srpe = rpe * duration

    ext_clean: dict[str, float] = {}
    ext_sum = 0.0
    has_any = False
    for k, raw in (session.external_load or {}).items():
        v = _finite_or_none(raw)
        if v is None:
            continue
        ext_clean[k] = v
        ext_sum += v
        has_any = True

    return SessionMetrics(
        duration_min=duration,
        rpe=rpe,
        srpe_load=srpe,
        external_load_total=ext_sum if has_any else None,
        external_load=ext_clean,
    )
