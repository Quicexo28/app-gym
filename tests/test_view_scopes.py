from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from app.auth.athlete_access import can_switch_athlete
from app.auth.deps import require_role
from app.auth.types import Plan, Role
from app.auth.view_scopes import (
    ViewScopes,
    effective_role_for_scopes,
    reset_current_view_scopes,
    resolve_view_scopes,
    set_current_view_scopes,
)
from app.db.models_auth import User


def _make_user(*, role: Role = Role.USER, plan: Plan = Plan.FREE) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{role.value}-{plan.value}@example.com",
        phone_number=None,
        google_sub=None,
        password_hash="x",
        role=role,
        plan=plan,
        is_active=True,
    )


@contextmanager
def active_scopes(scopes: ViewScopes) -> Iterator[None]:
    token = set_current_view_scopes(scopes)
    try:
        yield
    finally:
        reset_current_view_scopes(token)


def test_headers_cannot_escalate_a_plain_user() -> None:
    user = _make_user()

    scopes = resolve_view_scopes(user, "1", "1")

    assert scopes == ViewScopes(admin=False, coach=False)
    assert effective_role_for_scopes(user, scopes) == Role.USER


def test_coach_plan_unlocks_coach_view_without_coach_role() -> None:
    user = _make_user(role=Role.USER, plan=Plan.COACH)

    scopes = resolve_view_scopes(user, "1", "1")

    assert scopes == ViewScopes(admin=False, coach=True)
    assert effective_role_for_scopes(user, scopes) == Role.COACH


def test_admin_keeps_admin_role_with_coach_view_on() -> None:
    admin = _make_user(role=Role.ADMIN)

    scopes = resolve_view_scopes(admin, "1", "1")

    assert scopes == ViewScopes(admin=True, coach=True)
    assert effective_role_for_scopes(admin, scopes) == Role.ADMIN


def test_admin_endpoints_stay_available_while_coaching() -> None:
    admin = _make_user(role=Role.ADMIN)
    dep = require_role(Role.ADMIN)

    with active_scopes(ViewScopes(admin=True, coach=True)):
        assert dep(admin) is admin
        # La vista coach abre sujetos ajenos sin apagar los permisos de admin.
        assert can_switch_athlete(admin) is True


def test_admin_view_alone_does_not_open_other_subjects() -> None:
    admin = _make_user(role=Role.ADMIN)

    with active_scopes(ViewScopes(admin=True, coach=False)):
        assert can_switch_athlete(admin) is False


def test_require_role_rejects_when_scope_is_off() -> None:
    admin = _make_user(role=Role.ADMIN)
    dep = require_role(Role.ADMIN)

    with active_scopes(ViewScopes(admin=False, coach=True)), pytest.raises(HTTPException) as exc:
        dep(admin)

    assert exc.value.status_code == 403


def test_coach_view_off_keeps_subject_switching_closed() -> None:
    coach = _make_user(role=Role.COACH, plan=Plan.PRO)

    with active_scopes(ViewScopes()):
        assert can_switch_athlete(coach) is False

    with active_scopes(ViewScopes(coach=True)):
        assert can_switch_athlete(coach) is True
