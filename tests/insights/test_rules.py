from __future__ import annotations

from datetime import UTC, datetime, timedelta

from coach_ai.insights import build_insights
from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
NAME = "Press banca"


def session(
    day_offset: int,
    load: float,
    reps: int,
    *,
    rpe: float,
    completed: int = 3,
    prescribed: int = 3,
    wellness: tuple[float, float, float] = (7.5, 4.0, 7.5),
) -> Session:
    sets = []
    for index in range(prescribed):
        sets.append(
            StrengthSet(
                reps=reps,
                load_kg=load,
                meta={
                    "completed": index < completed,
                    "effort_scale": "rpe",
                    "effort_value": rpe,
                },
            )
        )
    sleep, stress, sensations = wellness
    return Session(
        athlete_id="user_1",
        start_time=NOW - timedelta(days=day_offset),
        duration_min=60,
        exercises=[
            StrengthExercise(
                name=NAME,
                sets=sets,
                meta={"target_reps_min": 8, "target_reps_max": 12, "group": "Pecho"},
            )
        ],
        meta={
            "wellness_signals": {
                "sleep": {"score_1_10": sleep},
                "stress": {"score_1_10": stress},
                "sensations": {"score_1_10": sensations},
            }
        },
    )


def signals(sessions: list[Session]):
    return build_insights(sessions, athlete_id="user_1", now=NOW).signals


def test_senala_margen_de_progresion_cuando_cumple_con_esfuerzo_de_sobra():
    sessions = [
        session(21, 60.0, 10, rpe=8.0),
        session(14, 60.0, 11, rpe=8.0),
        session(7, 60.0, 12, rpe=7.5),
    ]
    signal = next(r for r in signals(sessions) if r.exercise == NAME)

    assert signal.kind == "progression_margin"
    assert signal.reference_load_kg is not None
    assert signal.reference_load_kg > 60.0
    assert "12 reps" in signal.evidence
    assert signal.rule  # la condicion viaja con la sugerencia


def test_senala_esfuerzo_al_limite_cuando_cumplio_justo():
    sessions = [
        session(21, 60.0, 12, rpe=9.5),
        session(14, 60.0, 12, rpe=9.5),
        session(7, 60.0, 12, rpe=9.5),
    ]
    signal = next(r for r in signals(sessions) if r.exercise == NAME)

    assert signal.kind == "effort_at_limit"
    assert signal.reference_load_kg == 60.0


def test_senala_que_el_plan_no_se_completa():
    sessions = [
        session(21, 80.0, 8, rpe=8.0),
        session(14, 80.0, 8, rpe=8.0),
        session(7, 80.0, 6, rpe=8.0, completed=1, prescribed=4),
    ]
    signal = next(r for r in signals(sessions) if r.exercise == NAME)

    assert signal.kind == "plan_shortfall"
    assert signal.reference_load_kg is not None
    assert signal.reference_load_kg < 80.0


def test_senala_fatiga_cuando_el_esfuerzo_sube_y_el_bienestar_cae():
    """Mismo peso, RPE subiendo, durmiendo mal: es la senal de fatiga acumulada."""
    sessions = [
        session(24, 70.0, 8, rpe=7.0, wellness=(8.0, 3.0, 8.0)),
        session(18, 70.0, 8, rpe=7.5, wellness=(8.0, 3.0, 8.0)),
        session(12, 70.0, 8, rpe=7.5, wellness=(4.0, 8.0, 4.0)),
        session(3, 70.0, 8, rpe=9.0, wellness=(3.5, 8.5, 3.5)),
    ]
    signal = next(r for r in signals(sessions) if r.exercise == NAME)

    assert signal.kind == "fatigue_rising"
    assert "RPE" in signal.evidence


def test_calla_con_menos_de_tres_sesiones():
    sessions = [session(10, 60.0, 12, rpe=7.0), session(5, 60.0, 12, rpe=7.0)]
    assert signals(sessions) == []


def test_no_senala_margen_si_el_bienestar_esta_bajo():
    """Cumplir el plan no basta: con mal descanso no se señala margen."""
    sessions = [
        session(21, 60.0, 12, rpe=7.5, wellness=(4.0, 8.0, 4.0)),
        session(14, 60.0, 12, rpe=7.5, wellness=(4.0, 8.0, 4.0)),
        session(7, 60.0, 12, rpe=7.5, wellness=(4.0, 8.0, 4.0)),
    ]
    kinds = {r.kind for r in signals(sessions) if r.exercise == NAME}

    assert "progression_margin" not in kinds


def test_detecta_fatiga_aunque_el_bienestar_promedio_siga_aceptable():
    """El promedio de la ventana tapaba la caida reciente: eso fallaba con datos reales."""
    sessions = [
        session(9, 80.0, 8, rpe=7.0, wellness=(9.0, 2.0, 9.0)),
        session(6, 80.0, 8, rpe=7.5, wellness=(9.0, 2.0, 9.0)),
        session(3, 80.0, 8, rpe=8.0, wellness=(6.0, 5.0, 6.0)),
        session(1, 80.0, 8, rpe=9.0, wellness=(5.5, 6.0, 5.5)),
    ]
    signal = next(r for r in signals(sessions) if r.exercise == NAME)

    assert signal.kind == "fatigue_rising"


def multi_exercise_session(
    day_offset: int, rpe: float, wellness: tuple[float, float, float], completed: int = 3
) -> Session:
    """Sesión con dos ejercicios: la descarga se sugiere a nivel atleta, no de uno."""
    sleep, stress, sensations = wellness
    return Session(
        athlete_id="user_1",
        start_time=NOW - timedelta(days=day_offset),
        duration_min=60,
        exercises=[
            StrengthExercise(
                name=name,
                sets=[
                    StrengthSet(
                        reps=8,
                        load_kg=70.0,
                        meta={
                            "completed": index < completed,
                            "effort_scale": "rpe",
                            "effort_value": rpe,
                        },
                    )
                    for index in range(3)
                ],
                meta={"target_reps_min": 8, "target_reps_max": 12, "group": "Full"},
            )
            for name in ("Press banca", "Remo con barra")
        ],
        meta={
            "wellness_signals": {
                "sleep": {"score_1_10": sleep},
                "stress": {"score_1_10": stress},
                "sensations": {"score_1_10": sensations},
            }
        },
    )


def test_sugiere_descarga_cuando_hay_fatiga_en_varios_ejercicios_y_mal_wellness():
    sessions = [
        multi_exercise_session(9, 7.0, (8.0, 3.0, 8.0)),
        multi_exercise_session(6, 7.5, (4.0, 8.0, 4.0)),
        multi_exercise_session(2, 9.0, (3.5, 8.5, 3.5)),
    ]
    signal = next(r for r in signals(sessions) if r.kind == "deload_suggested")

    assert "descarga" in signal.reading.lower()
    assert "sueño" in signal.evidence
    assert signal.reference_load_kg is None  # no propone carga: es decision del entrenador


def test_senala_adherencia_baja_con_su_porcentaje():
    sessions = [
        multi_exercise_session(9, 8.0, (7.0, 4.0, 4.0), completed=1),
        multi_exercise_session(5, 8.0, (7.0, 4.0, 4.0), completed=1),
        multi_exercise_session(1, 8.0, (7.0, 4.0, 4.0), completed=1),
    ]
    signal = next(r for r in signals(sessions) if r.kind == "low_adherence")

    assert "33%" in signal.evidence
    assert "motivación" in signal.evidence
