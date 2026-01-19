from __future__ import annotations

from datetime import datetime

from coach_ai.training_core import Session, Severity, summarize_issues, validate_session
from coach_ai.training_core.schema import StrengthExercise, StrengthSet


def test_validate_session_strength_set_errors():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, 0),  # naive tz -> WARN
        duration_min=60,
        rpe=7,
        exercises=[
            StrengthExercise(
                name="Bench",
                sets=[
                    StrengthSet(reps=8, load_kg=-80),  # ERROR load_negative
                ],
            )
        ],
    )

    issues = validate_session(s)
    summary = summarize_issues(issues)

    assert summary["error"] >= 1
    assert summary["warn"] >= 1  # start_time_naive

    codes = {i.code for i in issues}
    assert "load_negative" in codes
    assert "start_time_naive" in codes


def test_validate_session_missing_exercises_is_warn():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, 0),
        duration_min=45,
        rpe=None,
        exercises=[],
    )
    issues = validate_session(s)
    assert any(i.code == "exercises_missing" and i.severity == Severity.WARN for i in issues)
