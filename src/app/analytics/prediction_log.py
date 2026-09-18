"""Registro y resolución de lo que el motor predice.

Los backtests de `scripts/backtest/` miden el motor contra el pasado. Esto lo
mide contra lo que el usuario vio de verdad: cada predicción se guarda cuando se
muestra y se resuelve cuando llega la sesión que la contesta. Es la única
validación que no se puede maquillar eligiendo bien la ventana.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db.models import PredictionLog
from coach_ai.insights import AthleteInsights
from coach_ai.training_core.schema import Session

KIND_NEXT_TOP_SET = "next_top_set"


def record_predictions(db: DbSession, insights: AthleteInsights) -> int:
    """Guarda una fila por predicción mostrada. Devuelve cuántas escribió."""
    written = 0
    for prediction in insights.predictions:
        db.add(
            PredictionLog(
                athlete_id=insights.athlete_id,
                created_at_utc=insights.generated_at,
                kind=KIND_NEXT_TOP_SET,
                exercise_name=prediction.exercise,
                method=prediction.method,
                predicted_value=prediction.point_kg,
                interval_low=prediction.low_kg,
                interval_high=prediction.high_kg,
                coverage=prediction.coverage,
                context={"basis_sessions": prediction.basis_sessions},
            )
        )
        written += 1
    return written


def _top_load(session: Session, exercise_name: str) -> float | None:
    loads = [
        float(st.load_kg or 0.0)
        for ex in session.exercises
        if ex.name == exercise_name
        for st in ex.sets
        if not st.is_warmup and st.reps > 0 and (st.load_kg or 0) > 0
    ]
    return max(loads) if loads else None


def resolve_pending(db: DbSession, athlete_id: str, sessions: list[Session]) -> int:
    """Cierra las predicciones que ya tienen respuesta en el historial.

    Una predicción se resuelve con la **primera** sesión posterior que incluya
    ese ejercicio: es lo que se prometió ("tu próxima serie tope"), no el mejor
    resultado del mes.
    """
    pending = (
        db.execute(
            select(PredictionLog).where(
                PredictionLog.athlete_id == athlete_id,
                PredictionLog.resolved_at_utc.is_(None),
            )
        )
        .scalars()
        .all()
    )
    if not pending:
        return 0

    ordered = sorted(sessions, key=lambda s: s.start_time)
    resolved = 0

    for row in pending:
        for session in ordered:
            if session.start_time <= row.created_at_utc:
                continue
            actual = _top_load(session, row.exercise_name or "")
            if actual is None:
                continue
            row.actual_value = actual
            row.resolved_at_utc = datetime.now(UTC)
            if row.interval_low is not None and row.interval_high is not None:
                row.inside_interval = bool(row.interval_low <= actual <= row.interval_high)
            resolved += 1
            break

    return resolved


def coverage_report(db: DbSession, athlete_id: str) -> dict:
    """Qué tan bien le fue al motor con este atleta, con sus propios datos."""
    rows = (
        db.execute(
            select(PredictionLog).where(
                PredictionLog.athlete_id == athlete_id,
                PredictionLog.resolved_at_utc.is_not(None),
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return {"resueltas": 0}

    errors = [abs(r.predicted_value - r.actual_value) for r in rows if r.actual_value is not None]
    inside = [r.inside_interval for r in rows if r.inside_interval is not None]

    return {
        "resueltas": len(rows),
        "mae_kg": (sum(errors) / len(errors)) if errors else None,
        "cobertura_intervalo": (sum(1 for x in inside if x) / len(inside)) if inside else None,
        "cobertura_objetivo": rows[0].coverage,
    }
