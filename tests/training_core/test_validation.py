from __future__ import annotations

from datetime import datetime

from coach_ai.training_core import Session, Severity, summarize_issues, validate_session


def test_validate_session_errors_and_warnings():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, 0),  # naive tz -> WARN
        duration_min=-10,  # ERROR
        rpe=11,  # ERROR
        modality=None,  # INFO
        external_load={"distance_km": -5},  # ERROR
    )

    issues = validate_session(s)
    summary = summarize_issues(issues)

    assert summary["error"] >= 3
    assert summary["warn"] >= 1
    assert summary["info"] >= 1

    # Ensure specific codes exist
    codes = {i.code for i in issues}
    assert "duration_non_positive" in codes
    assert "rpe_out_of_range" in codes
    assert "external_load_negative" in codes
    assert "start_time_naive" in codes
    assert "modality_missing" in codes


def test_validate_session_missing_rpe_is_warn():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, 0),
        duration_min=45,
        rpe=None,
        modality="strength",
        external_load={},
    )
    issues = validate_session(s)
    assert any(i.code == "rpe_missing" and i.severity == Severity.WARN for i in issues)
