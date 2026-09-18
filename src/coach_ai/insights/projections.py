"""Proyecciones a partir de las adaptaciones que ha mostrado *este* atleta.

"Según cómo viene adaptando, si sostiene este plan puede esperar +X kg en press
banca en 8 semanas." Eso se puede sostener: no sale de un modelo poblacional
—que fue medido y no supera baselines triviales— sino de extrapolar la propia
tendencia del atleta, con el intervalo que da su propia variabilidad.

Método: pendiente de Theil-Sen (mediana de las pendientes entre todos los pares
de puntos) sobre el 1RM estimado. Es robusta: una sesión floja o un día de
singles pesados no tuercen la recta, cosa que sí le pasa a mínimos cuadrados.
El intervalo sale de los cuantiles de esas mismas pendientes, así que no asume
ninguna distribución.

Tres límites que el texto de la proyección debe respetar siempre:

1. Es **condicional** al plan que viene cumpliendo: si cambia la adherencia,
   la proyección deja de valer.
2. Es **asociación, no promesa**: describe la inercia reciente, no una ley.
3. Si hay poco historial, no se proyecta. Mejor callar que inventar una cifra.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from coach_ai.compliance import session_compliance
from coach_ai.training_core.schema import Session

from .types import Projection

MIN_SESSIONS = 6
MIN_SPAN_DAYS = 28
LOOKBACK_DAYS = 84  # 12 semanas: suficiente para una tendencia, no tanto como para arrastrar otra etapa
DEFAULT_HORIZON_WEEKS = 8
INTERVAL_LOW_Q = 0.25
INTERVAL_HIGH_Q = 0.75
METHOD = "theil_sen_own_history_v1"


def _epley(load_kg: float, reps: int) -> float:
    return load_kg * (1.0 + reps / 30.0)


def _series(sessions: list[Session], exercise: str, now: datetime) -> list[tuple[float, float]]:
    """(semanas desde el inicio de la ventana, e1RM) del ejercicio."""
    cutoff = now - timedelta(days=LOOKBACK_DAYS)
    points: list[tuple[datetime, float]] = []
    for session in sorted(sessions, key=lambda s: s.start_time):
        if session.start_time < cutoff:
            continue
        best = 0.0
        for ex in session.exercises:
            if ex.name != exercise:
                continue
            for st in ex.sets:
                if st.is_warmup or st.reps <= 0 or (st.load_kg or 0) <= 0:
                    continue
                best = max(best, _epley(float(st.load_kg), st.reps))
        if best > 0:
            points.append((session.start_time, best))

    if not points:
        return []
    origin = points[0][0]
    return [((when - origin).days / 7.0, value) for when, value in points]


def _theil_sen(points: list[tuple[float, float]]) -> tuple[float, float, float] | None:
    """(pendiente mediana, cuantil bajo, cuantil alto) en unidades por semana."""
    slopes: list[float] = []
    for index, (x1, y1) in enumerate(points):
        for x2, y2 in points[index + 1 :]:
            if x2 - x1 <= 0:
                continue
            slopes.append((y2 - y1) / (x2 - x1))
    if len(slopes) < 3:
        return None
    slopes.sort()

    def quantile(q: float) -> float:
        position = min(int(round(q * (len(slopes) - 1))), len(slopes) - 1)
        return slopes[position]

    return (quantile(0.5), quantile(INTERVAL_LOW_Q), quantile(INTERVAL_HIGH_Q))


def _adherence(sessions: list[Session], now: datetime, exercise: str | None = None) -> float | None:
    """Cumplimiento medio de series en las últimas 4 semanas."""
    cutoff = now - timedelta(days=28)
    ratios: list[float] = []
    for session in sessions:
        if session.start_time < cutoff:
            continue
        for compliance in session_compliance(session).exercises:
            if exercise is not None and compliance.name != exercise:
                continue
            ratio = compliance.set_completion_ratio
            if ratio is not None:
                ratios.append(ratio)
    return (sum(ratios) / len(ratios)) if ratios else None


def build_projections(
    sessions: list[Session],
    exercises: list[str],
    now: datetime,
    *,
    horizon_weeks: int = DEFAULT_HORIZON_WEEKS,
) -> list[Projection]:
    """Una proyección por ejercicio con historia suficiente, más la general."""
    out: list[Projection] = []
    per_exercise_pct: list[tuple[float, float, float]] = []

    for exercise in sorted(exercises):
        points = _series(sessions, exercise, now)
        if len(points) < MIN_SESSIONS or (points[-1][0] - points[0][0]) * 7 < MIN_SPAN_DAYS:
            continue

        estimate = _theil_sen(points)
        if estimate is None:
            continue
        slope, low_slope, high_slope = estimate

        current = points[-1][1]
        # Una proyeccion no puede dejar la carga por debajo de cero: sin este
        # tope, un ejercicio con peso añadido cercano a 0 (dominadas, fondos)
        # proyectaba cargas negativas.
        floor = -current
        change = max(slope * horizon_weeks, floor)
        low = max(low_slope * horizon_weeks, floor)
        high = max(high_slope * horizon_weeks, floor)
        adherence = _adherence(sessions, now, exercise)

        out.append(
            Projection(
                scope=exercise,
                horizon_weeks=horizon_weeks,
                current_kg=current,
                expected_change_kg=change,
                low_change_kg=low,
                high_change_kg=high,
                expected_change_pct=(change / current) if current else 0.0,
                adherence=adherence,
                basis_sessions=len(points),
                method=METHOD,
            )
        )
        if current:
            per_exercise_pct.append((change / current, low / current, high / current))

    if per_exercise_pct:
        count = len(per_exercise_pct)
        # Mediana e intervalo intercuartil entre ejercicios, no la media de los
        # intervalos: promediando, un ejercicio con historia ruidosa abria el
        # rango global a "-20% o +35%", que no informa ninguna decision.
        changes = sorted(value for value, _, _ in per_exercise_pct)

        def quantile(values: list[float], q: float) -> float:
            position = min(int(round(q * (len(values) - 1))), len(values) - 1)
            return values[position]

        mean_change = quantile(changes, 0.5)
        mean_low = quantile(changes, 0.25)
        mean_high = quantile(changes, 0.75)
        out.insert(
            0,
            Projection(
                scope="global",
                horizon_weeks=horizon_weeks,
                current_kg=None,
                expected_change_kg=None,
                low_change_kg=None,
                high_change_kg=None,
                expected_change_pct=mean_change,
                low_change_pct=mean_low,
                high_change_pct=mean_high,
                adherence=_adherence(sessions, now),
                basis_sessions=count,
                method=METHOD,
            ),
        )

    return out


def weekly_sets_by_group(sessions: list[Session], now: datetime) -> dict[str, float]:
    cutoff = now - timedelta(days=28)
    totals: dict[str, float] = defaultdict(float)
    for session in sessions:
        if session.start_time < cutoff:
            continue
        for compliance in session_compliance(session).exercises:
            totals[compliance.group or "sin_grupo"] += compliance.sets_completed / 4.0
    return dict(sorted(totals.items()))
