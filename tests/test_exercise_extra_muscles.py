from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.exercises_catalog import (
    ExerciseCreateRequest,
    ExtraMuscle,
    _normalize_payload,
)


def _payload(**extra) -> ExerciseCreateRequest:
    return ExerciseCreateRequest(
        group="Pecho", family="Fondos", variation="Con Peso Corporal", **extra
    )


def test_missing_extras_means_keep_current():
    assert _normalize_payload(_payload()).extra_muscles is None


def test_empty_list_means_clear():
    assert _normalize_payload(_payload(extra_muscles=[])).extra_muscles == []


def test_secondary_default_weight_and_main_weight_kept():
    normalized = _normalize_payload(
        _payload(
            extra_muscles=[
                ExtraMuscle(group="Tríceps", weight=1.0),
                ExtraMuscle(group="Hombros"),
            ]
        )
    )
    assert normalized.extra_muscles == [
        {"group": "Hombros", "weight": 0.5},
        {"group": "Tríceps", "weight": 1.0},
    ]


def test_extra_equal_to_primary_is_dropped_and_duplicates_keep_max_weight():
    normalized = _normalize_payload(
        _payload(
            extra_muscles=[
                ExtraMuscle(group="pecho"),
                ExtraMuscle(group="Triceps", weight=0.5),
                ExtraMuscle(group="Tríceps", weight=1.0),
            ]
        )
    )
    assert normalized.extra_muscles == [{"group": "Tríceps", "weight": 1.0}]


@pytest.mark.parametrize("weight", [0, -1, 1.5])
def test_invalid_weight_is_rejected(weight):
    with pytest.raises(ValidationError):
        ExtraMuscle(group="Tríceps", weight=weight)
