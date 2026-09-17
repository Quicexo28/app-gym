from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.profile import ProfileUpdateRequest, _clean_text


def test_profile_update_accepts_account_fields() -> None:
    payload = ProfileUpdateRequest(
        display_name="Santiago Quiceno",
        username="santi_qp",
        birth_date=date(1998, 5, 12),
        gender="Male",
        height_cm=178.44,
    )

    assert payload.display_name == "Santiago Quiceno"
    assert payload.gender == "male"
    assert payload.height_cm == 178.4


def test_profile_update_rejects_unknown_gender() -> None:
    with pytest.raises(ValidationError):
        ProfileUpdateRequest(gender="astronaut")


def test_profile_update_rejects_future_birth_date() -> None:
    tomorrow = datetime.now(UTC).date() + timedelta(days=1)
    with pytest.raises(ValidationError):
        ProfileUpdateRequest(birth_date=tomorrow)


def test_profile_update_rejects_out_of_range_height() -> None:
    with pytest.raises(ValidationError):
        ProfileUpdateRequest(height_cm=310.0)


def test_profile_update_distinguishes_omitted_from_cleared() -> None:
    omitted = ProfileUpdateRequest(username="santi_qp")
    cleared = ProfileUpdateRequest(username="santi_qp", bio=None)

    assert "bio" not in omitted.model_fields_set
    assert "bio" in cleared.model_fields_set


def test_clean_text_collapses_whitespace_and_empties_to_none() -> None:
    assert _clean_text("  Santiago   Quiceno  ") == "Santiago Quiceno"
    assert _clean_text("   ") is None
