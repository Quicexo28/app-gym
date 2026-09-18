from __future__ import annotations

from datetime import UTC, datetime, timedelta

from coach_ai.insights import build_insights
from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet

NOW = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
NAME = "Press banca"


def session(days_ago: int, load: float, *, name: str = NAME, completed: int = 3) -> Session:
    return Session(
        athlete_id="user_1",
        start_time=NOW - timedelta(days=days_ago),
        duration_min=60,
        exercises=[
            StrengthExercise(
                name=name,
                sets=[
                    StrengthSet(
                        reps=5,
                        load_kg=load,
                        meta={"completed": index < completed, "effort_scale": "rpe", "effort_value": 8},
                    )
                    for index in range(3)
                ],
                meta={"target_reps_min": 4, "target_reps_max": 6, "group": "Pecho"},
            )
        ],
    )


def projections(sessions: list[Session]):
    return build_insights(sessions, athlete_id="user_1", now=NOW).projections


def test_proyecta_la_tendencia_propia_del_atleta():
    """+2.5 kg cada 2 semanas durante 10 semanas -> ~+10 kg en 8 semanas."""
    sessions = [session(70 - week * 7, 100.0 + week * 1.25) for week in range(11)]
    by_exercise = next(p for p in projections(sessions) if p.scope == NAME)

    assert by_exercise.horizon_weeks == 8
    assert 8.0 <= by_exercise.expected_change_kg <= 12.0
    assert by_exercise.low_change_kg <= by_exercise.expected_change_kg <= by_exercise.high_change_kg
    assert by_exercise.current_kg is not None


def test_proyeccion_global_resume_los_ejercicios():
    sessions = [session(70 - week * 7, 100.0 + week * 1.25) for week in range(11)]
    global_projection = next(p for p in projections(sessions) if p.scope == "global")

    assert global_projection.expected_change_pct > 0
    assert global_projection.current_kg is None  # el global va en porcentaje


def test_no_proyecta_con_historial_corto():
    sessions = [session(days, 100.0) for days in (20, 15, 10, 5)]
    assert projections(sessions) == []


def test_estancado_proyecta_cerca_de_cero():
    sessions = [session(70 - week * 7, 100.0) for week in range(11)]
    by_exercise = next(p for p in projections(sessions) if p.scope == NAME)

    assert abs(by_exercise.expected_change_kg) < 1.0


def test_la_proyeccion_lleva_la_adherencia_observada():
    """La proyeccion es condicional al plan que viene cumpliendo."""
    sessions = [
        session(70 - week * 7, 100.0 + week, completed=2 if week % 2 else 3) for week in range(11)
    ]
    by_exercise = next(p for p in projections(sessions) if p.scope == NAME)

    assert by_exercise.adherence is not None
    assert 0.0 < by_exercise.adherence <= 1.0
