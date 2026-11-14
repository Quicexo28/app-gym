from __future__ import annotations

import uuid

import pytest
from diet_support import _make_user
from fastapi import HTTPException

from app.auth.athlete_access import (
    get_or_404,
    get_owned_or_404,
    parse_uuid_or_404,
    personal_athlete_id_for_user,
    require_athlete_access,
)


class _Row:
    def __init__(self, athlete_id: str) -> None:
        self.athlete_id = athlete_id


class _Db:
    def __init__(self, row: object | None) -> None:
        self.row = row

    def get(self, model: type, row_id: object) -> object | None:
        return self.row


def test_require_athlete_access_returns_normalized_id() -> None:
    user = _make_user()
    own = personal_athlete_id_for_user(user)
    assert require_athlete_access(None, user, f"  {own} ") == own


def test_require_athlete_access_blank_is_400() -> None:
    with pytest.raises(HTTPException) as exc:
        require_athlete_access(None, _make_user(), "   ")
    assert exc.value.status_code == 400


def test_parse_uuid_or_404_default_and_custom_status() -> None:
    value = uuid.uuid4()
    assert parse_uuid_or_404(str(value), "x") == value
    with pytest.raises(HTTPException) as exc:
        parse_uuid_or_404("nope", "no existe")
    assert (exc.value.status_code, exc.value.detail) == (404, "no existe")
    with pytest.raises(HTTPException) as exc:
        parse_uuid_or_404("nope", "bad", status_code=400)
    assert exc.value.status_code == 400


def test_get_or_404_missing_row() -> None:
    with pytest.raises(HTTPException) as exc:
        get_or_404(_Db(None), _Row, uuid.uuid4(), "falta")  # type: ignore[arg-type]
    assert (exc.value.status_code, exc.value.detail) == (404, "falta")


def test_get_owned_or_404_missing_returns_404() -> None:
    with pytest.raises(HTTPException) as exc:
        get_owned_or_404(_Db(None), _make_user(), _Row, uuid.uuid4(), "falta")  # type: ignore[arg-type]
    assert exc.value.status_code == 404


def test_get_owned_or_404_own_row_ok_and_foreign_403() -> None:
    owner, other = _make_user(), _make_user()
    row = _Row(personal_athlete_id_for_user(owner))
    assert get_owned_or_404(_Db(row), owner, _Row, uuid.uuid4()) is row  # type: ignore[arg-type]
    with pytest.raises(HTTPException) as exc:
        get_owned_or_404(_Db(row), other, _Row, uuid.uuid4())  # type: ignore[arg-type]
    assert exc.value.status_code == 403
