"""Señales que salen de cruzar cumplimiento, esfuerzo y bienestar.

La app **no decide ni manda**. Lee lo que ya registró —cumplimiento del plan,
RPE/RIR reportado, sueño, estrés y sensaciones— y nombra lo que esos datos
muestran. Quien decide qué hacer con eso es el entrenador, o el atleta con su
criterio.

Por eso cada señal se redacta como lectura, no como instrucción: "hay margen de
progresión" en vez de "sube el peso". La carga de referencia (`reference_load_kg`)
es un dato de contexto para quien programa, no una orden de carga.

Ejemplos de lo que reconoce:

- Plan completo, repeticiones en el tope del rango, esfuerzo con margen y buen
  descanso -> hay margen de progresión.
- El esfuerzo sube sesión tras sesión moviendo el mismo peso mientras el
  bienestar cae -> fatiga acumulándose; es esperable que el rendimiento baje.

Cada señal viaja con la regla exacta que la disparó y con los números del propio
atleta, para que se pueda discutir. Ninguna está validada todavía contra
resultados: se registran en `prediction_logs` y se contrastan con lo que pasa
después. La heurística viene de la práctica estándar (doble progresión,
autorregulación por RIR), no de este repositorio.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from coach_ai.compliance import session_compliance
from coach_ai.training_core.schema import Session

from .types import TrainingSignal

MIN_SESSIONS_FOR_SIGNAL = 3
EFFORT_EASY_RPE = 8.0  # RPE <= 8 es RIR >= 2: queda margen
EFFORT_HARD_RPE = 9.0
EFFORT_RISE = 0.5  # subida de RPE que ya cuenta como señal
WELLNESS_LOW = 4.5  # sueño o sensaciones por debajo de esto
STRESS_HIGH = 7.0
WELLNESS_WINDOW_DAYS = 10
WELLNESS_DROP = 2.0  # caida (sobre 10) que ya cuenta aunque el nivel no sea bajo
DEFAULT_STEP_KG = 2.5
SHORTFALL_RATIO = 0.75
# Señales de atleta (no de un ejercicio suelto)
DELOAD_MIN_EXERCISES = 2  # la fatiga tiene que verse en mas de un ejercicio
LOW_ADHERENCE = 0.80
LOW_MOTIVATION = 5.0


def _exercise_history(
    sessions: list[Session], exercise: str
) -> list[tuple[datetime, float, int, float | None, float | None]]:
    """(cuándo, tope, reps del tope, RPE medio, cumplimiento) por sesión."""
    out: list[tuple[datetime, float, int, float | None, float | None]] = []
    for session in sorted(sessions, key=lambda s: s.start_time):
        compliance = next(
            (c for c in session_compliance(session).exercises if c.name == exercise), None
        )
        if compliance is None or compliance.top_load_kg is None:
            continue
        reps_of_top = 0
        for ex in session.exercises:
            if ex.name != exercise:
                continue
            for st in ex.sets:
                if not st.is_warmup and float(st.load_kg or 0) == compliance.top_load_kg:
                    reps_of_top = max(reps_of_top, st.reps)
        out.append(
            (
                session.start_time,
                compliance.top_load_kg,
                reps_of_top,
                compliance.mean_effort_rpe,
                compliance.set_completion_ratio,
            )
        )
    return out


def _athlete_level_signals(
    sessions: list[Session], per_exercise: list[TrainingSignal], now: datetime
) -> list[TrainingSignal]:
    """Lecturas del atleta completo, no de un ejercicio: descarga y adherencia.

    Van aparte porque la decision que informan tambien es distinta: una descarga
    se programa para la semana entera, no para un ejercicio.
    """
    out: list[TrainingSignal] = []
    cutoff = now - timedelta(days=WELLNESS_WINDOW_DAYS)
    recent = [s for s in sessions if s.start_time >= cutoff]
    if not recent:
        return out

    fatigued = [s for s in per_exercise if s.kind == "fatigue_rising"]

    compliances = [session_compliance(s) for s in sorted(recent, key=lambda s: s.start_time)]
    ratios = [
        e.set_completion_ratio
        for c in compliances
        for e in c.exercises
        if e.set_completion_ratio is not None
    ]

    def mean(values: list[float]) -> float | None:
        return (sum(values) / len(values)) if values else None

    # Igual que en la señal por ejercicio: se mira lo reciente, no el promedio
    # de la ventana. Dos dias buenos al principio tapaban el bajon actual.
    last_two = compliances[-2:]
    sleep_avg = mean([c.sleep_1_10 for c in last_two if c.sleep_1_10 is not None])
    stress_avg = mean([c.stress_1_10 for c in last_two if c.stress_1_10 is not None])
    motivation_avg = mean([c.sensations_1_10 for c in last_two if c.sensations_1_10 is not None])
    adherence = mean(ratios)

    wellness_bad = (sleep_avg is not None and sleep_avg <= WELLNESS_LOW) or (
        stress_avg is not None and stress_avg >= STRESS_HIGH
    )

    if len(fatigued) >= DELOAD_MIN_EXERCISES and wellness_bad:
        pieces = []
        if sleep_avg is not None:
            pieces.append(f"sueño {sleep_avg:.1f}/10")
        if stress_avg is not None:
            pieces.append(f"estrés {stress_avg:.1f}/10")
        if motivation_avg is not None:
            pieces.append(f"motivación {motivation_avg:.1f}/10")
        out.append(
            TrainingSignal(
                kind="deload_suggested",
                exercise="",
                reading="Marcadores de fatiga alta: se sugiere valorar una descarga",
                evidence=(
                    f"Esfuerzo en aumento en {len(fatigued)} ejercicios, con "
                    + ", ".join(pieces)
                ),
                rule=(
                    f"fatiga detectada en >= {DELOAD_MIN_EXERCISES} ejercicios y "
                    f"sueño <= {WELLNESS_LOW} o estres >= {STRESS_HIGH}"
                ),
                reference_load_kg=None,
            )
        )

    if adherence is not None and adherence < LOW_ADHERENCE:
        motivation_text = (
            f", con motivación {motivation_avg:.1f}/10" if motivation_avg is not None else ""
        )
        out.append(
            TrainingSignal(
                kind="low_adherence",
                exercise="",
                reading="Adherencia baja al plan",
                evidence=(
                    f"Se completó el {adherence * 100:.0f}% de las series prescritas en los "
                    f"últimos {WELLNESS_WINDOW_DAYS} días{motivation_text}"
                ),
                rule=f"cumplimiento medio de series < {LOW_ADHERENCE * 100:.0f}%",
                reference_load_kg=None,
            )
        )

    return out


def _step_kg(loads: list[float]) -> float:
    """El escalón que usa ese atleta en ese ejercicio, no uno inventado."""
    steps = [abs(b - a) for a, b in zip(loads, loads[1:], strict=False) if abs(b - a) > 0.01]
    return min(steps) if steps else DEFAULT_STEP_KG


def _wellness_trend(
    sessions: list[Session], now: datetime
) -> tuple[float | None, float | None, float | None]:
    """(bienestar reciente, bienestar previo, estres reciente).

    Se mira la tendencia y no el promedio de la ventana entera: promediando 10
    dias, unos dias buenos tapan un deterioro de los ultimos dos entrenos, que
    es justo cuando la fatiga se esta acumulando.
    """
    cutoff = now - timedelta(days=WELLNESS_WINDOW_DAYS)
    recent: list[tuple[datetime, float | None, float | None]] = []
    for session in sessions:
        if session.start_time < cutoff:
            continue
        compliance = session_compliance(session)
        scores = [s for s in (compliance.sleep_1_10, compliance.sensations_1_10) if s is not None]
        recent.append(
            (
                session.start_time,
                (sum(scores) / len(scores)) if scores else None,
                compliance.stress_1_10,
            )
        )
    recent.sort(key=lambda item: item[0])

    wellbeing = [value for _, value, _ in recent if value is not None]
    stresses = [value for _, _, value in recent if value is not None]
    if not wellbeing:
        return (None, None, (sum(stresses) / len(stresses)) if stresses else None)

    last_two = wellbeing[-2:]
    earlier = wellbeing[:-2]
    return (
        sum(last_two) / len(last_two),
        (sum(earlier) / len(earlier)) if earlier else None,
        (sum(stresses[-2:]) / len(stresses[-2:])) if stresses else None,
    )


def _target_reps_max(sessions: list[Session], exercise: str) -> int | None:
    for session in sorted(sessions, key=lambda s: s.start_time, reverse=True):
        for ex in session.exercises:
            if ex.name == exercise and ex.meta.get("target_reps_max") is not None:
                return int(ex.meta["target_reps_max"])
    return None


def build_signals(
    sessions: list[Session], exercises: list[str], now: datetime
) -> list[TrainingSignal]:
    """Una señal por ejercicio cuando los datos dicen algo; si no, silencio."""
    out: list[TrainingSignal] = []

    for exercise in exercises:
        history = _exercise_history(sessions, exercise)
        if len(history) < MIN_SESSIONS_FOR_SIGNAL:
            continue

        # El bienestar se lee en las sesiones donde aparece ESTE ejercicio, no en
        # todas: entrenar pecho descansado y espalda reventado son dos historias
        # distintas, y promediarlas borra las dos.
        own_sessions = [
            session
            for session in sessions
            if any(ex.name == exercise for ex in session.exercises)
        ]
        wellbeing, wellbeing_before, stress = _wellness_trend(own_sessions, now)
        wellness_dropping = (
            wellbeing is not None
            and wellbeing_before is not None
            and wellbeing_before - wellbeing >= WELLNESS_DROP
        )
        wellness_low = (
            (wellbeing is not None and wellbeing <= WELLNESS_LOW)
            or (stress is not None and stress >= STRESS_HIGH)
            or wellness_dropping
        )

        _, last_load, last_reps, last_effort, last_completion = history[-1]
        loads = [load for _, load, _, _, _ in history]
        step = _step_kg(loads)
        target_max = _target_reps_max(sessions, exercise)

        completed_all = last_completion is None or last_completion >= 0.999
        reps_at_top = target_max is not None and last_reps >= target_max
        effort_easy = last_effort is not None and last_effort <= EFFORT_EASY_RPE
        effort_hard = last_effort is not None and last_effort >= EFFORT_HARD_RPE

        # Esfuerzo que sube moviendo lo mismo o menos: la señal clásica de que
        # la fatiga se acumula antes de que caiga el rendimiento.
        efforts = [e for _, _, _, e, _ in history if e is not None]
        effort_rising = (
            len(efforts) >= 3
            and efforts[-1] - (sum(efforts[-4:-1]) / len(efforts[-4:-1])) >= EFFORT_RISE
            and last_load <= max(loads[-4:-1] or [last_load])
        )

        if effort_rising and wellness_low:
            wellbeing_text = f", con bienestar {wellbeing:.1f}/10" if wellbeing is not None else ""
            out.append(
                TrainingSignal(
                    kind="fatigue_rising",
                    exercise=exercise,
                    reading=(
                        "Fatiga acumulándose: es esperable que las próximas sesiones rindan menos"
                    ),
                    evidence=(
                        f"El esfuerzo subió a RPE {efforts[-1]:.1f} moviendo el mismo peso"
                        f"{wellbeing_text}"
                    ),
                    rule=(
                        f"RPE sube >= {EFFORT_RISE} sobre las 3 sesiones previas sin subir carga, "
                        f"y el bienestar esta <= {WELLNESS_LOW}, cayo >= {WELLNESS_DROP} puntos "
                        f"o el estres llega a {STRESS_HIGH}"
                    ),
                    reference_load_kg=None,
                )
            )
            continue

        if completed_all and reps_at_top and effort_easy and not wellness_low:
            out.append(
                TrainingSignal(
                    kind="progression_margin",
                    exercise=exercise,
                    reading="Hay margen de progresión",
                    evidence=(
                        f"Plan completo, {last_reps} reps (tope del rango) con RPE "
                        f"{last_effort:.1f} y bienestar normal"
                    ),
                    rule=(
                        f"todas las series completadas + reps >= objetivo maximo + "
                        f"RPE <= {EFFORT_EASY_RPE}, con bienestar normal"
                    ),
                    reference_load_kg=last_load + step,
                )
            )
            continue

        if completed_all and effort_hard:
            out.append(
                TrainingSignal(
                    kind="effort_at_limit",
                    exercise=exercise,
                    reading="Cumple el plan, pero al límite del esfuerzo",
                    evidence=f"Todas las series completadas con RPE {last_effort:.1f}",
                    rule=f"todas las series completadas pero RPE >= {EFFORT_HARD_RPE}",
                    reference_load_kg=last_load,
                )
            )
            continue

        if last_completion is not None and last_completion < SHORTFALL_RATIO:
            out.append(
                TrainingSignal(
                    kind="plan_shortfall",
                    exercise=exercise,
                    reading="El plan no se está completando a esta carga",
                    evidence=(
                        f"Solo se completó el {last_completion * 100:.0f}% de las series "
                        f"prescritas a {last_load:g} kg"
                    ),
                    rule=f"menos del {SHORTFALL_RATIO * 100:.0f}% de las series prescritas",
                    reference_load_kg=max(0.0, last_load - step),
                )
            )

    out.extend(_athlete_level_signals(sessions, out, now))
    return out
