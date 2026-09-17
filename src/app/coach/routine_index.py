from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.coach.muscle_groups import canonicalize_muscle_group
from app.coach.reports import normalize_exercise_name
from app.db.models import RoutineTemplateExerciseIndex

GLOBAL_ROUTINES_SCOPE = "__global__"


def _template_key(routine: dict[str, Any]) -> str:
    shared_id = routine.get("shared_routine_id")
    if shared_id:
        return f"shared:{shared_id}"
    return f"name:{normalize_exercise_name(str(routine.get('name') or ''))}"


def rebuild_routine_template_exercise_index(
    db: Session,
    coach_user_id: uuid.UUID,
    scopes: dict[str, list[dict[str, Any]]],
    accessible_athlete_ids: set[str],
) -> None:
    """Reconstruye por completo el indice (coach, atleta, rutina, ejercicio)
    a partir del blob de RoutineStore recien guardado.

    Delete+insert total para este coach en cada PUT /routines/store: el
    volumen es "rutinas x ejercicios de la cartera de un coach", barato de
    recalcular completo y evita diffear incrementalmente contra el JSON
    anterior. Solo se indexan scopes de atletas actualmente accesibles -
    evita romper por FK si quedo un scope de un atleta ya desvinculado.
    """
    db.execute(
        delete(RoutineTemplateExerciseIndex).where(
            RoutineTemplateExerciseIndex.coach_user_id == coach_user_id
        )
    )

    for athlete_id, routines in scopes.items():
        if athlete_id == GLOBAL_ROUTINES_SCOPE or athlete_id not in accessible_athlete_ids:
            continue
        if not isinstance(routines, list):
            continue
        for routine in routines:
            if not isinstance(routine, dict):
                continue
            routine_id = str(routine.get("id") or "").strip()
            routine_name = str(routine.get("name") or "").strip()
            if not routine_id or not routine_name:
                continue
            template_key = _template_key(routine)
            for exercise in routine.get("exercises") or []:
                if not isinstance(exercise, dict):
                    continue
                name = str(exercise.get("name") or "").strip()
                if not name:
                    continue
                db.add(
                    RoutineTemplateExerciseIndex(
                        id=uuid.uuid4(),
                        coach_user_id=coach_user_id,
                        athlete_id=athlete_id,
                        routine_id=routine_id,
                        routine_name=routine_name,
                        template_key=template_key,
                        exercise_name_normalized=normalize_exercise_name(name),
                        muscle_group=canonicalize_muscle_group(exercise.get("group")),
                        target_sets_min=exercise.get("target_sets_min"),
                        target_sets_max=exercise.get("target_sets_max"),
                        target_reps_min=exercise.get("target_reps_min"),
                        target_reps_max=exercise.get("target_reps_max"),
                    )
                )
