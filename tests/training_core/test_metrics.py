from __future__ import annotations

from datetime import datetime

from coach_ai.training_core import Session, compute_session_metrics
from coach_ai.training_core.schema import StrengthExercise, StrengthSet


def test_compute_srpe_and_volume_load():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, 0),
        duration_min=60,
        rpe=7,
        exercises=[
            StrengthExercise(
                name="Bench",
                sets=[
                    StrengthSet(reps=8, load_kg=80),
                    StrengthSet(reps=8, load_kg=80),
                ],
            )
        ],
    )
    m = compute_session_metrics(s)
    assert m.srpe_load == 420
    assert m.volume_load_kg == 1280
    assert m.sets_total == 2
    assert m.reps_total == 16
    assert m.exercise_count == 1


def test_metrics_handle_missing_rpe_and_no_sets():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, 0),
        duration_min=30,
        rpe=None,
        exercises=[],
    )
    m = compute_session_metrics(s)
    assert m.srpe_load is None
    assert m.volume_load_kg is None
