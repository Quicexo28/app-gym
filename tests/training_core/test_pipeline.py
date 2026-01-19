from __future__ import annotations

from datetime import datetime

from coach_ai.training_core import Session, process_sessions
from coach_ai.training_core.schema import StrengthExercise, StrengthSet


def _sess(
    athlete: str, dt: datetime, sets: list[tuple[int, float]] | None, rpe: float | None = None
):
    exercises = []
    if sets is not None:
        exercises = [
            StrengthExercise(
                name="Bench",
                sets=[StrengthSet(reps=reps, load_kg=kg) for reps, kg in sets],
            )
        ]
    return Session(
        athlete_id=athlete,
        start_time=dt,
        duration_min=60,
        rpe=rpe,
        exercises=exercises,
    )


def test_process_sessions_groups_and_orders_by_time():
    # a1 has two sessions out of order, a2 has one
    s1 = _sess("a1", datetime(2024, 1, 2, 10, 0, 0), [(8, 80), (8, 80)], rpe=7)  # volume 1280
    s2 = _sess("a1", datetime(2024, 1, 1, 10, 0, 0), [(10, 70)], rpe=6)  # volume 700
    s3 = _sess("a2", datetime(2024, 1, 1, 9, 0, 0), [(5, 100)], rpe=None)  # volume 500

    res = process_sessions([s1, s2, s3], normalizer_min_n=2, clip_z=None)

    assert len(res.processed) == 3
    assert set(res.by_athlete.keys()) == {"a1", "a2"}

    a1 = res.by_athlete["a1"]
    # order should be [index of s2, index of s1] => [1, 0]
    assert a1.order == [1, 0]
    assert a1.metrics["volume_load_kg"] == [700.0, 1280.0]
    assert a1.metrics["srpe_load"] == [360.0, 420.0]

    # Normalized series should exist and be same length
    assert len(a1.normalized["volume_load_kg"]) == 2
    assert all(v is not None for v in a1.normalized["volume_load_kg"])
    # Rough check: first smaller than second -> z1 < z2
    assert a1.normalized["volume_load_kg"][0] < a1.normalized["volume_load_kg"][1]

    a2 = res.by_athlete["a2"]
    assert a2.order == [2]
    assert a2.metrics["volume_load_kg"] == [500.0]
    # rpe None -> srpe_load None
    assert a2.metrics["srpe_load"] == [None]


def test_process_sessions_surfaces_missing_exercises_via_issues():
    s = _sess("a1", datetime(2024, 1, 1, 10, 0, 0), sets=None, rpe=7)  # no exercises
    res = process_sessions([s], normalizer_min_n=2)

    ps = res.processed[0]
    codes = {i.code for i in ps.issues}
    assert "exercises_missing" in codes

    a1 = res.by_athlete["a1"]
    # volume metric is None
    assert a1.metrics["volume_load_kg"] == [None]
    # normalized stays None for missing values
    assert a1.normalized["volume_load_kg"] == [None]
