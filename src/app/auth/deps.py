from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.security import decode_token
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models_auth import User

security = HTTPBearer(auto_error=False)

DbSession = Session


def _unauthorized(detail: str = "Not authenticated.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[DbSession, Depends(get_db)],
) -> User:
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

    return user


def require_role(min_role: Role) -> Callable[[User], User]:
    order = {Role.USER: 0, Role.COACH: 1, Role.ADMIN: 2}

    def dep(user: Annotated[User, Depends(get_current_user)]) -> User:
        if order[user.role] < order[min_role]:
            raise HTTPException(status_code=403, detail="Insufficient role.")
        return user

    return dep


def require_plan(allowed: set[Plan]) -> Callable[[User], User]:
    def dep(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.plan not in allowed:
            raise HTTPException(status_code=403, detail="Plan does not allow this feature.")
        return user

    return dep
