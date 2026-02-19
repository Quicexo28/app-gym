from __future__ import annotations

from contextvars import ContextVar, Token
from enum import StrEnum

from app.auth.types import Plan, Role
from app.db.models_auth import User


class ViewMode(StrEnum):
    ADMIN = "admin"
    COACH = "coach"
    USER_PLUS = "user_plus"
    USER_NORMAL = "user_normal"


_CURRENT_VIEW_MODE: ContextVar[ViewMode | None] = ContextVar("current_view_mode", default=None)


def parse_view_mode(raw: str | None) -> ViewMode | None:
    if raw is None:
        return None
    value = raw.strip().lower()
    if not value:
        return None
    try:
        return ViewMode(value)
    except ValueError:
        return None


def default_user_mode_for_plan(plan: Plan) -> ViewMode:
    if plan == Plan.FREE:
        return ViewMode.USER_NORMAL
    return ViewMode.USER_PLUS


def allowed_view_modes_for_user(user: User) -> list[ViewMode]:
    if user.role == Role.ADMIN:
        return [ViewMode.ADMIN, ViewMode.COACH, ViewMode.USER_PLUS, ViewMode.USER_NORMAL]

    if user.role == Role.COACH:
        return [ViewMode.COACH, ViewMode.USER_PLUS]

    return [default_user_mode_for_plan(user.plan)]


def default_view_mode_for_user(user: User) -> ViewMode:
    return allowed_view_modes_for_user(user)[0]


def resolve_view_mode_for_user(user: User, requested: str | None) -> ViewMode:
    allowed = allowed_view_modes_for_user(user)
    parsed = parse_view_mode(requested)
    if parsed in allowed:
        return parsed
    return allowed[0]


def set_current_view_mode(mode: ViewMode) -> Token[ViewMode | None]:
    return _CURRENT_VIEW_MODE.set(mode)


def reset_current_view_mode(token: Token[ViewMode | None]) -> None:
    _CURRENT_VIEW_MODE.reset(token)


def get_current_view_mode(user: User) -> ViewMode:
    current = _CURRENT_VIEW_MODE.get()
    if current is not None:
        return current
    return default_view_mode_for_user(user)


def effective_role_for_mode(user: User, mode: ViewMode) -> Role:
    if mode == ViewMode.ADMIN and user.role == Role.ADMIN:
        return Role.ADMIN
    if mode == ViewMode.COACH and user.role in {Role.COACH, Role.ADMIN}:
        return Role.COACH
    return Role.USER


def effective_plan_for_mode(user: User, mode: ViewMode) -> Plan:
    if mode == ViewMode.USER_NORMAL:
        return Plan.FREE
    if mode == ViewMode.USER_PLUS:
        return Plan.PRO
    return user.plan
