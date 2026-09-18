"""What the engine can honestly say about an athlete's training.

Three layers, each with a different bar:

1. **Description** -- facts already recorded (current e1RM, weekly sets, days
   since last session). Bar: the arithmetic is right.
2. **Events** -- things that happened, each carrying the rule that detected it,
   so the athlete can audit or dispute it. Bar: the rule is explicit.
3. **Prediction** -- one number only: the next top set per exercise, which is
   the last top set plus an interval built from the athlete's own history.

Why the prediction is so modest: three backtests over real data (28 public gym
logs, 6614 endurance athletes, 800k powerlifters) showed the previous
probabilistic layer losing to trivial baselines, and no fitted model beating
"repeat the last weight" (6.14 kg MAE vs 6.44 kg for the best one). The
interval, on the other hand, measured 92.8% empirical coverage for a 90%
target, so that part does carry information.

When there is not enough history the engine abstains instead of guessing.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from coach_ai.compliance import session_compliance
from coach_ai.training_core.schema import Session

from .projections import build_projections
from .rules import build_signals
from .types import AthleteInsights, ExerciseState, NextSetPrediction, TrainingEvent

MIN_SESSIONS_FOR_PREDICTION = 6
STALL_LOOKBACK = 10
STALL_WITHOUT_PR = 5
RECENT_WINDOW_DAYS = 28
DROPPED_AFTER_DAYS = 45
COVERAGE = 0.90
MIN_HALF_WIDTH_KG = 2.5  # por debajo de un disco chico el intervalo es humo
METHOD = "persistence+empirical_interval_v1"


def _epley(load_kg: float, reps: int) -> float:
    return load_kg * (1.0 + reps / 30.0)


def _top_sets_by_exercise(sessions: list[Session]) -> dict[str, list[tuple[datetime, float, int]]]:
    """(when, top load, reps of that top set) per exercise, chronological."""
    out: dict[str, list[tuple[datetime, float, int]]] = defaultdict(list)
    for session in sorted(sessions, key=lambda s: s.start_time):
        for exercise in session.exercises:
            best: tuple[float, int] | None = None
            for st in exercise.sets:
                if st.is_warmup or st.reps <= 0:
                    continue
                load = float(st.load_kg or 0.0)
                if load <= 0:
                    continue
                if best is None or load > best[0]:
                    best = (load, st.reps)
            if best is not None:
                out[exercise.name].append((session.start_time, best[0], best[1]))
    return out


def _interval(history: list[float], coverage: float) -> float:
    """Half-width from the athlete's own session-to-session changes.

    Empirical quantile of |change| between consecutive top sets: it needs no
    distributional assumption and adapts to whoever is lifting.
    """
    changes = [abs(b - a) for a, b in zip(history, history[1:], strict=False)]
    if not changes:
        return MIN_HALF_WIDTH_KG
    ordered = sorted(changes)
    index = min(int(round(coverage * (len(ordered) - 1))), len(ordered) - 1)
    return max(ordered[index], MIN_HALF_WIDTH_KG)


def _detect_events(
    exercise: str, points: list[tuple[datetime, float, int]], now: datetime
) -> list[TrainingEvent]:
    events: list[TrainingEvent] = []
    loads = [load for _, load, _ in points]
    if not loads:
        return events

    best = max(loads)
    last_when, last_load, _ = points[-1]

    if last_load >= best and len(points) >= 2 and last_load > max(loads[:-1]):
        events.append(
            TrainingEvent(
                kind="personal_record",
                exercise=exercise,
                at=last_when,
                detail=f"{last_load:g} kg, tu mejor marca en {exercise}",
                rule="la serie tope de la ultima sesion supera a todas las anteriores",
            )
        )

    if len(points) >= STALL_LOOKBACK:
        window = loads[-STALL_LOOKBACK:]
        best_in_window = max(window)
        sessions_since_best = len(window) - 1 - max(
            index for index, value in enumerate(window) if value == best_in_window
        )
        if sessions_since_best >= STALL_WITHOUT_PR:
            events.append(
                TrainingEvent(
                    kind="stall",
                    exercise=exercise,
                    at=last_when,
                    detail=(
                        f"{sessions_since_best} sesiones sin superar {best_in_window:g} kg "
                        f"en {exercise}"
                    ),
                    rule=(
                        f"{STALL_WITHOUT_PR}+ sesiones seguidas sin superar el mejor tope "
                        f"de las ultimas {STALL_LOOKBACK}"
                    ),
                )
            )

    days_idle = (now - last_when).days
    if days_idle >= DROPPED_AFTER_DAYS:
        events.append(
            TrainingEvent(
                kind="dropped_exercise",
                exercise=exercise,
                at=last_when,
                detail=f"{days_idle} dias sin entrenar {exercise}",
                rule=f"la ultima sesion del ejercicio tiene mas de {DROPPED_AFTER_DAYS} dias",
            )
        )

    return events


def build_insights(
    sessions: list[Session], *, athlete_id: str, now: datetime | None = None
) -> AthleteInsights:
    """Description + events + one honest prediction per exercise."""
    moment = now or datetime.now(UTC)
    if not sessions:
        return AthleteInsights(athlete_id=athlete_id, generated_at=moment)

    by_exercise = _top_sets_by_exercise(sessions)
    recent_cutoff = moment - timedelta(days=RECENT_WINDOW_DAYS)

    states: list[ExerciseState] = []
    events: list[TrainingEvent] = []
    predictions: list[NextSetPrediction] = []
    abstained: list[str] = []

    for exercise, points in sorted(by_exercise.items()):
        loads = [load for _, load, _ in points]
        e1rms = [_epley(load, reps) for _, load, reps in points]
        last_when = points[-1][0]

        sets_recent = sum(
            1
            for session in sessions
            if session.start_time >= recent_cutoff
            for ex in session.exercises
            if ex.name == exercise
            for st in ex.sets
            if not st.is_warmup and st.reps > 0 and (st.load_kg or 0) > 0
        )

        states.append(
            ExerciseState(
                name=exercise,
                sessions=len(points),
                last_top_load_kg=loads[-1],
                best_top_load_kg=max(loads),
                e1rm_kg=e1rms[-1],
                best_e1rm_kg=max(e1rms),
                last_session_at=last_when,
                days_since_last=(moment - last_when).days,
                sets_last_4w=sets_recent,
            )
        )

        events.extend(_detect_events(exercise, points, moment))

        if len(points) < MIN_SESSIONS_FOR_PREDICTION:
            abstained.append(exercise)
            continue

        half_width = _interval(loads, COVERAGE)
        predictions.append(
            NextSetPrediction(
                exercise=exercise,
                point_kg=loads[-1],
                low_kg=max(0.0, loads[-1] - half_width),
                high_kg=loads[-1] + half_width,
                coverage=COVERAGE,
                basis_sessions=len(points),
                method=METHOD,
            )
        )

    weekly_sets: dict[str, float] = defaultdict(float)
    recent_sessions = [s for s in sessions if s.start_time >= recent_cutoff]
    for session in recent_sessions:
        for exercise in session_compliance(session).exercises:
            weekly_sets[exercise.group or "sin_grupo"] += exercise.sets_completed / 4.0

    return AthleteInsights(
        athlete_id=athlete_id,
        generated_at=moment,
        exercises=states,
        signals=build_signals(sessions, [s.name for s in states], moment),
        projections=build_projections(sessions, [s.name for s in states], moment),
        events=sorted(events, key=lambda e: e.at, reverse=True),
        predictions=predictions,
        abstained=abstained,
        weekly_sets_by_group=dict(sorted(weekly_sets.items())),
        sessions_last_4w=len(recent_sessions),
    )
