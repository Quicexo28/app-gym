from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.auth.types import Plan, Role

PWD_CONTEXT = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-insecure-change-me")
JWT_ALG = os.environ.get("JWT_ALG", "HS256")
ACCESS_TOKEN_MIN = int(os.environ.get("ACCESS_TOKEN_MIN", "60"))


def hash_password(password: str) -> str:
    return PWD_CONTEXT.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return PWD_CONTEXT.verify(password, password_hash)


def create_access_token(*, sub: str, role: Role, plan: Plan) -> str:
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=ACCESS_TOKEN_MIN)
    payload: dict[str, Any] = {
        "sub": sub,
        "role": role.value,
        "plan": plan.value,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError as err:
        raise ValueError("invalid_token") from err
