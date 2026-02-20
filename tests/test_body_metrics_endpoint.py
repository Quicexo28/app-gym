from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.body_metrics import (
    BodyMeasurementCreateRequest,
    _metric_definitions,
    _serialize_item,
    _to_utc,
)
from app.db.models import BodyMeasurement


def test_body_measurement_payload_requires_at_least_one_numeric_measure() -> None:
    with pytest.raises(ValidationError):
        BodyMeasurementCreateRequest(athlete_id="athlete_1")


def test_body_measurement_payload_accepts_weight_only() -> None:
    payload = BodyMeasurementCreateRequest(athlete_id="athlete_1", weight_kg=82.5)
    assert payload.weight_kg == 82.5


def test_to_utc_normalizes_naive_datetime() -> None:
    naive = datetime(2026, 2, 20, 14, 30, 0)
    normalized = _to_utc(naive)
    assert normalized.tzinfo is not None
    assert normalized.utcoffset() == UTC.utcoffset(normalized)


def test_serialize_item_computes_bmi_and_ratios() -> None:
    row = BodyMeasurement(
        id=uuid.uuid4(),
        athlete_id="athlete_1",
        measured_by_user_id=uuid.uuid4(),
        measured_at=datetime(2026, 2, 20, 14, 0, tzinfo=UTC),
        created_at_utc=datetime(2026, 2, 20, 14, 1, tzinfo=UTC),
        weight_kg=80.0,
        height_cm=180.0,
        waist_cm=82.0,
        hip_cm=96.0,
    )

    item = _serialize_item(row)

    assert item.bmi == 24.69
    assert item.waist_to_height_ratio == 0.4556
    assert item.waist_to_hip_ratio == 0.8542


def test_metric_definitions_include_waist_and_weight() -> None:
    keys = {item.key for item in _metric_definitions()}
    assert "waist_cm" in keys
    assert "weight_kg" in keys
