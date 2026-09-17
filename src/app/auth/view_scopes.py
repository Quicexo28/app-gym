from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass

from app.auth.types import Plan, Role
from app.db.models_auth import User

ADMIN_VIEW_HEADER = "X-App-Admin-View"
COACH_VIEW_HEADER = "X-App-Coach-View"

_TRUTHY = {"1", "true", "on", "yes"}


@dataclass(frozen=True)
class ViewScopes:
    """Vistas activas del cliente.

    Son ortogonales a proposito: un admin puede tener la vista coach encendida sin
    perder sus permisos de admin. Antes eran un solo enum de 4 valores y cada vista
    apagaba a la otra.
    """

    admin: bool = False
    coach: bool = False


_CURRENT_VIEW_SCOPES: ContextVar[ViewScopes | None] = ContextVar("current_view_scopes", default=None)


def can_use_admin_view(user: User) -> bool:
    return user.role == Role.ADMIN


def can_use_coach_view(user: User) -> bool:
    # El plan coach habilita la vista; los roles coach/admin la conservan aunque su plan cambie.
    return user.plan == Plan.COACH or user.role in {Role.COACH, Role.ADMIN}


def parse_view_flag(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() in _TRUTHY


def resolve_view_scopes(user: User, admin_raw: str | None, coach_raw: str | None) -> ViewScopes:
    """El cliente pide vistas por header; el servidor las recorta a lo que la cuenta permite."""
    return ViewScopes(
        admin=parse_view_flag(admin_raw) and can_use_admin_view(user),
        coach=parse_view_flag(coach_raw) and can_use_coach_view(user),
    )


def set_current_view_scopes(scopes: ViewScopes) -> Token[ViewScopes | None]:
    return _CURRENT_VIEW_SCOPES.set(scopes)


def reset_current_view_scopes(token: Token[ViewScopes | None]) -> None:
    try:
        _CURRENT_VIEW_SCOPES.reset(token)
    except ValueError:
        # FastAPI may run dependency teardown in a different context/threadpool.
        _CURRENT_VIEW_SCOPES.set(None)


def get_current_view_scopes() -> ViewScopes:
    return _CURRENT_VIEW_SCOPES.get() or ViewScopes()


def effective_role_for_scopes(user: User, scopes: ViewScopes) -> Role:
    if scopes.admin and can_use_admin_view(user):
        return Role.ADMIN
    if scopes.coach and can_use_coach_view(user):
        return Role.COACH
    return Role.USER
