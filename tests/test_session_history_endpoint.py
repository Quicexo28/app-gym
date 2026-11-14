from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.sessions import SessionUpdateRequest, _apply_update, _history_item
from app.db.models import TrainingSession


def _row() -> TrainingSession:
    return TrainingSession(
        id=uuid.uuid4(),
        athlete_id="athlete_1",
        start_time=datetime(2026, 3, 1, 18, 0, tzinfo=UTC),
        duration_min=60.0,
        rpe=7.0,
        modality="strength",
        source="ui_routine",
        exercises=[{"name": "Press banca", "sets": [{"reps": 10, "load_kg": 50.0}]}],
        meta={"routine_name": "Empuje", "note": "bien"},
        volume_load_kg=500.0,
        sets_total=1,
        reps_total=10,
    )


def test_history_item_exposes_routine_name_and_note() -> None:
    item = _history_item(_row())
    assert item.routine_name == "Empuje"
    assert item.note == "bien"
    assert item.exercises[0]["name"] == "Press banca"
    assert item.meta == {"routine_name": "Empuje", "note": "bien"}


def test_update_recomputes_metrics_when_sets_change() -> None:
    row = _row()
    body = SessionUpdateRequest(
        exercises=[
            {
                "name": "Press banca",
                "sets": [{"reps": 8, "load_kg": 60.0}, {"reps": 8, "load_kg": 60.0}],
            }
        ]
    )
    _apply_update(row, body)
    assert row.sets_total == 2
    assert row.reps_total == 16
    assert row.volume_load_kg == 960.0


def test_update_changes_only_sent_fields() -> None:
    row = _row()
    _apply_update(row, SessionUpdateRequest(duration_min=45))
    assert row.duration_min == 45.0
    assert row.rpe == 7.0
    assert row.meta["note"] == "bien"
    assert row.volume_load_kg == 500.0


def test_update_empty_note_removes_it_and_null_rpe_clears_it() -> None:
    row = _row()
    _apply_update(row, SessionUpdateRequest(note="  ", rpe=None))
    assert "note" not in row.meta
    assert row.meta["routine_name"] == "Empuje"
    assert row.rpe is None


def test_update_rejects_invalid_values() -> None:
    with pytest.raises(ValidationError):
        SessionUpdateRequest(rpe=11)
    with pytest.raises(ValidationError):
        SessionUpdateRequest(duration_min=0)
