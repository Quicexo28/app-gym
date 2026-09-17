from __future__ import annotations

from typing import TYPE_CHECKING, Any

from coach_ai.training_core import normalize_exercise_name

if TYPE_CHECKING:
    from app.db.models import BodyMeasurement, TrainingSession

__all__ = ["build_measurement_report", "build_session_report", "normalize_exercise_name"]


def _set_index(set_row: dict[str, Any]) -> int | None:
    meta = set_row.get("meta") or {}
    value = meta.get("set_index")
    return int(value) if isinstance(value, int | float) else None


def _pct_delta(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round(((current - previous) / abs(previous)) * 100, 1)


def _exercise_sets_by_index(exercise: dict[str, Any]) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for set_row in exercise.get("sets") or []:
        idx = _set_index(set_row)
        if idx is not None:
            out[idx] = set_row
    return out


def build_session_report(session: TrainingSession, previous: TrainingSession | None) -> dict[str, Any]:
    """Compara la sesion recien guardada contra la anterior de la misma rutina.

    Matchea ejercicios por nombre normalizado y series por meta.set_index -
    hoy no existe id de catalogo estable que viaje hasta la sesion guardada
    (ver grounding de la Fase 0). Si no hay sesion previa, o el ejercicio/serie
    no existia antes, la comparacion queda marcada `comparable: False` en vez
    de fallar.
    """
    meta = session.meta or {}
    previous_by_name: dict[str, dict[str, Any]] = {}
    if previous is not None:
        for exercise in previous.exercises or []:
            previous_by_name[normalize_exercise_name(exercise.get("name", ""))] = exercise

    exercises_out: list[dict[str, Any]] = []
    for exercise in session.exercises or []:
        name = exercise.get("name", "")
        exercise_meta = exercise.get("meta") or {}
        prev_exercise = previous_by_name.get(normalize_exercise_name(name))

        per_set: list[dict[str, Any]] = []
        load_deltas: list[float] = []
        volume_deltas: list[float] = []

        if prev_exercise is not None:
            prev_sets_by_index = _exercise_sets_by_index(prev_exercise)
            for set_row in exercise.get("sets") or []:
                idx = _set_index(set_row)
                prev_set = prev_sets_by_index.get(idx) if idx is not None else None
                if prev_set is None:
                    per_set.append({"set_index": idx, "comparable": False})
                    continue
                load_kg = float(set_row.get("load_kg") or 0)
                reps = float(set_row.get("reps") or 0)
                prev_load_kg = float(prev_set.get("load_kg") or 0)
                prev_reps = float(prev_set.get("reps") or 0)
                load_delta = _pct_delta(load_kg, prev_load_kg)
                volume_delta = _pct_delta(load_kg * reps, prev_load_kg * prev_reps)
                if load_delta is not None:
                    load_deltas.append(load_delta)
                if volume_delta is not None:
                    volume_deltas.append(volume_delta)
                per_set.append(
                    {
                        "set_index": idx,
                        "comparable": True,
                        "load_delta_pct": load_delta,
                        "volume_delta_pct": volume_delta,
                    }
                )

        exercises_out.append(
            {
                "name": name,
                "comparable": prev_exercise is not None,
                "avg_load_delta_pct": round(sum(load_deltas) / len(load_deltas), 1) if load_deltas else None,
                "avg_volume_delta_pct": round(sum(volume_deltas) / len(volume_deltas), 1) if volume_deltas else None,
                "per_set": per_set,
                "athlete_note": exercise_meta.get("athlete_note"),
            }
        )

    return {
        "session_id": str(session.id),
        "routine_id": meta.get("routine_id"),
        "routine_name": meta.get("routine_name"),
        "start_time": session.start_time.isoformat(),
        "has_previous_session": previous is not None,
        "session_note": meta.get("note"),
        "wellness_signals": meta.get("wellness_signals"),
        "exercises": exercises_out,
    }


def build_measurement_report(
    latest: BodyMeasurement,
    previous: BodyMeasurement | None,
) -> dict[str, Any]:
    # Reusa el mismo calculo de deltas que ya usa el hilo de ProgressShare -
    # evita reimplementar "% vs. medicion anterior" por segunda vez.
    from app.api.v1.endpoints.progress import summarize_metrics

    return {
        "measurement_id": str(latest.id),
        "measured_at": latest.measured_at.isoformat(),
        "metrics": summarize_metrics(latest, previous),
        "notes": latest.notes,
    }
