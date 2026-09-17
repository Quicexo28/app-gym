from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.progress import (
    ProgressAuthor,
    ProgressCommentCreateRequest,
    ProgressShareCreateRequest,
    _serialize_share,
    display_label,
    summarize_metrics,
)
from app.auth.types import Role
from app.db.models import BodyMeasurement, ProgressShare, ProgressShareComment


def _measurement(**values: float) -> BodyMeasurement:
    return BodyMeasurement(
        id=uuid.uuid4(),
        athlete_id="athlete_1",
        measured_by_user_id=uuid.uuid4(),
        measured_at=datetime(2026, 7, 20, 10, 0, tzinfo=UTC),
        created_at_utc=datetime(2026, 7, 20, 10, 1, tzinfo=UTC),
        **values,
    )


def test_summarize_metrics_without_measurement_returns_empty() -> None:
    assert summarize_metrics(None, None) == []


def test_summarize_metrics_skips_missing_values_and_computes_delta() -> None:
    latest = _measurement(weight_kg=80.0, waist_cm=82.0)
    previous = _measurement(weight_kg=82.5, waist_cm=84.0)

    metrics = summarize_metrics(latest, previous)

    by_key = {entry["key"]: entry for entry in metrics}
    assert set(by_key) == {"weight_kg", "waist_cm"}
    assert by_key["weight_kg"]["delta"] == -2.5
    assert by_key["waist_cm"]["value"] == 82.0
    assert by_key["waist_cm"]["unit"] == "cm"


def test_summarize_metrics_delta_is_none_without_previous() -> None:
    metrics = summarize_metrics(_measurement(weight_kg=80.0), None)
    assert metrics[0]["delta"] is None


def test_display_label_prefers_username_then_email_local() -> None:
    assert display_label("santi_qp", "santiago@example.com") == "santi_qp"
    assert display_label("   ", "santiago@example.com") == "santiago"
    assert display_label(None, "santiago@example.com") == "santiago"


def test_share_note_is_optional_but_bounded() -> None:
    assert ProgressShareCreateRequest(athlete_id="athlete_1").note is None
    with pytest.raises(ValidationError):
        ProgressShareCreateRequest(athlete_id="athlete_1", note="x" * 601)


def test_comment_body_cannot_be_empty() -> None:
    with pytest.raises(ValidationError):
        ProgressCommentCreateRequest(body="")


def test_serialize_share_includes_snapshot_and_thread() -> None:
    author_id = uuid.uuid4()
    coach_id = uuid.uuid4()
    share = ProgressShare(
        id=uuid.uuid4(),
        athlete_id="athlete_1",
        author_user_id=author_id,
        note="Semana buena",
        snapshot={
            "metrics": [
                {"key": "weight_kg", "label": "Peso", "value": 80.0, "unit": "kg", "delta": -1.0}
            ],
            "sessions_total": 42,
            "sessions_recent": 8,
            "measured_at": "2026-07-20T10:00:00+00:00",
        },
        created_at_utc=datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
    )
    comment = ProgressShareComment(
        id=uuid.uuid4(),
        share_id=share.id,
        author_user_id=coach_id,
        body="Subamos volumen de pierna.",
        created_at_utc=datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
    )
    authors = {
        author_id: ProgressAuthor(user_id=str(author_id), label="santi_qp", role=Role.USER),
        coach_id: ProgressAuthor(user_id=str(coach_id), label="coach_ana", role=Role.COACH),
    }

    item = _serialize_share(share, [comment], authors)

    assert item.author.label == "santi_qp"
    assert item.sessions_total == 42
    assert item.sessions_recent == 8
    assert item.metrics[0].delta == -1.0
    assert item.comments[0].author.role == Role.COACH
    assert item.comments[0].body == "Subamos volumen de pierna."


def test_serialize_share_falls_back_when_author_missing() -> None:
    share = ProgressShare(
        id=uuid.uuid4(),
        athlete_id="athlete_1",
        author_user_id=uuid.uuid4(),
        note=None,
        snapshot={},
        created_at_utc=datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
    )

    item = _serialize_share(share, [], {})

    assert item.author.label == "Usuario"
    assert item.metrics == []
    assert item.sessions_total == 0
