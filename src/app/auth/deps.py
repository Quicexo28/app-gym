from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.security import decode_token
from app.auth.types import Role
from app.auth.view_scopes import (
    ADMIN_VIEW_HEADER,
    COACH_VIEW_HEADER,
    can_use_coach_view,
    effective_role_for_scopes,
    get_current_view_scopes,
    reset_current_view_scopes,
    resolve_view_scopes,
    set_current_view_scopes,
)
from app.db.engine import get_db
from app.db.models_auth import User

security = HTTPBearer(auto_error=False)

DbSession = Session


def _unauthorized(detail: str = "Not authenticated.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[DbSession, Depends(get_db)],
    request: Request,
) -> AsyncGenerator[User, None]:
    if creds is None or not creds.credentials:
        raise _unauthorized()

    token = creds.credentials
    try:
        payload = decode_token(token)
    except ValueError as err:
        raise _unauthorized("Invalid token.") from err

    sub = payload.get("sub")
    if not sub:
        raise _unauthorized("Invalid token payload.")

    try:
        user_id = uuid.UUID(sub)
    except ValueError as err:
        raise _unauthorized("Invalid user id in token.") from err

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized("User not found or inactive.")

    scopes = resolve_view_scopes(
        user,
        request.headers.get(ADMIN_VIEW_HEADER),
        request.headers.get(COACH_VIEW_HEADER),
    )
    request.state.view_scopes = scopes
    token_scopes = set_current_view_scopes(scopes)
    try:
        yield user
    finally:
        reset_current_view_scopes(token_scopes)


def require_role(min_role: Role) -> Callable[[User], User]:
    order = {Role.USER: 0, Role.COACH: 1, Role.ADMIN: 2}

    def dep(user: Annotated[User, Depends(get_current_user)]) -> User:
        effective_role = effective_role_for_scopes(user, get_current_view_scopes())
        if order[effective_role] < order[min_role]:
            raise HTTPException(status_code=403, detail="Insufficient role.")
        return user

    return dep


def require_coach_view(user: Annotated[User, Depends(get_current_user)]) -> User:
    """Gate para endpoints self-service de coach (gestion de atletas/notas).

    A diferencia de `can_switch_athlete`, no exige que el switch de vista
    coach este encendido en este momento - solo que el plan/rol lo habilite.
    """
    if not can_use_coach_view(user):
        raise HTTPException(status_code=403, detail="Requiere plan o rol coach.")
    return user
