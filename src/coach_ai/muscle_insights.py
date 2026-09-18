"""Agregacion por grupo muscular, para la vista coach.

No introduce estadistica nueva: generaliza el input de "una serie agregada
por atleta" (volume_load_kg/srpe_load, ver training_core/trends/latents) a
"una serie por (atleta, grupo muscular)", y reusa exactamente las mismas
primitivas (fit_normalizer/normalize_series, compute_trends,
compute_plateau_probability, combine_confidence) sobre esa serie.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from coach_ai.latents.confidence import combine_confidence
from coach_ai.latents.plateau import compute_plateau_probability
from coach_ai.training_core.muscle_groups import canonicalize_muscle_group
from coach_ai.training_core.naming import normalize_exercise_name
from coach_ai.training_core.normalization import fit_normalizer, normalize_series
from coach_ai.training_core.pipeline import AthleteSeries
from coach_ai.training_core.schema import Session, StrengthExercise
from coach_ai.trends import compute_trends
from coach_ai.trends.types import TrendDirection

MUSCLE_METRIC_KEY = "muscle_volume_kg"
# Series por musculo son mas cortas que la serie global del atleta (solo los
# dias que entreno ese musculo) - min_n mas bajo que el default de 10.
DEFAULT_NORMALIZER_MIN_N = 6


@dataclass(frozen=True, slots=True)
class MuscleSeriesPoint:
    t: datetime
    volume_kg: float


@dataclass(frozen=True, slots=True)
class MuscleGroupState:
    group: str
    trend_direction: str
    plateau_p: float | None
    confidence: float
    recent_series: list[MuscleSeriesPoint]
    exercises_involved: list[str]


def _exercise_group(
    exercise: StrengthExercise, catalog_group_by_name: dict[str, str | None]
) -> str | None:
    raw_group = (exercise.meta or {}).get("group")
    if not raw_group:
        raw_group = catalog_group_by_name.get(normalize_exercise_name(exercise.name))
    return canonicalize_muscle_group(raw_group)


def _exercise_volume_kg(exercise: StrengthExercise) -> float:
    return sum(float(s.load_kg) * float(s.reps) for s in exercise.sets)


def _build_group_series(
    sessions: list[Session], catalog_group_by_name: dict[str, str | None]
) -> dict[str, tuple[list[datetime], list[float], set[str]]]:
    """Una serie temporal independiente por grupo muscular: solo las sesiones
    donde ese grupo fue efectivamente entrenado. Rellenar con ceros los dias
    de descanso de ese musculo distorsionaria la tendencia (ver Fase 2 del
    plan: progresion se mide "cada vez que entreno X", no dia calendario).
    """
    out: dict[str, tuple[list[datetime], list[float], set[str]]] = {}
    for session in sorted(sessions, key=lambda s: s.start_time):
        session_volume: dict[str, float] = {}
        session_exercises: dict[str, set[str]] = {}
        for exercise in session.exercises:
            group = _exercise_group(exercise, catalog_group_by_name)
            if group is None:
                continue
            session_volume[group] = session_volume.get(group, 0.0) + _exercise_volume_kg(exercise)
            session_exercises.setdefault(group, set()).add(exercise.name)

        for group, volume in session_volume.items():
            times, values, names = out.setdefault(group, ([], [], set()))
            times.append(session.start_time)
            values.append(volume)
            names.update(session_exercises[group])

    return out


def compute_muscle_group_states(
    sessions: list[Session],
    priority_groups: list[str],
    *,
    catalog_group_by_name: dict[str, str | None] | None = None,
    window_days: int = 120,
) -> list[MuscleGroupState]:
    """Un MuscleGroupState por musculo prioritario del atleta.

    Reusa sin modificar las primitivas estadisticas existentes:
    fit_normalizer/normalize_series (Fase 1 del motor), compute_trends
    (Fase 2) y compute_plateau_probability/combine_confidence (Fase 3).
    """
    if not priority_groups:
        return []

    cutoff: datetime | None = None
    if sessions:
        latest = max(s.start_time for s in sessions)
        cutoff = latest - timedelta(days=window_days)
    windowed = [s for s in sessions if cutoff is None or s.start_time >= cutoff]

    group_series = _build_group_series(windowed, catalog_group_by_name or {})

    out: list[MuscleGroupState] = []
    for group in priority_groups:
        times, values, exercise_names = group_series.get(group, ([], [], set()))
        if not times:
            out.append(
                MuscleGroupState(
                    group=group,
                    trend_direction=TrendDirection.INSUFFICIENT.value,
                    plateau_p=None,
                    confidence=0.0,
                    recent_series=[],
                    exercises_involved=[],
                )
            )
            continue

        params, normalizer_issues = fit_normalizer(values, min_n=DEFAULT_NORMALIZER_MIN_N)
        normalized = normalize_series(values, params, clip_z=5.0)

        series = AthleteSeries(
            athlete_id="",
            order=list(range(len(times))),
            start_times=times,
            metrics={MUSCLE_METRIC_KEY: values},
            normalizers={MUSCLE_METRIC_KEY: params},
            normalizer_issues={MUSCLE_METRIC_KEY: normalizer_issues},
            normalized={MUSCLE_METRIC_KEY: normalized},
        )
        trend = compute_trends(series, metric_key=MUSCLE_METRIC_KEY, use_normalized=True)
        plateau_series, _plateau_expl = compute_plateau_probability(trend)

        last_point = trend.points[-1] if trend.points else None
        last_plateau = plateau_series[-1] if plateau_series else None
        confidence = combine_confidence(
            coverage=float(trend.summary["coverage"]),
            trend_confidence=last_point.confidence if last_point else None,
            issues=trend.issues,
        )

        recent = [
            MuscleSeriesPoint(t=t, volume_kg=round(v, 1))
            for t, v in list(zip(times, values, strict=True))[-12:]
        ]

        out.append(
            MuscleGroupState(
                group=group,
                trend_direction=last_point.direction.value
                if last_point
                else TrendDirection.INSUFFICIENT.value,
                plateau_p=last_plateau,
                confidence=confidence,
                recent_series=recent,
                exercises_involved=sorted(exercise_names),
            )
        )

    return out


def find_weakest_group(states: list[MuscleGroupState]) -> MuscleGroupState | None:
    """El musculo prioritario mas "rezagado": mayor probabilidad de
    estancamiento entre los que si tienen datos suficientes para evaluarlo.
    """
    candidates = [s for s in states if s.plateau_p is not None]
    if not candidates:
        return None
    return max(candidates, key=lambda s: s.plateau_p)
