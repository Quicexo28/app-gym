from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

import app.api.v1.endpoints.auth as auth_endpoint
from app.api.v1.endpoints.auth import GoogleLoginRequest, LoginRequest, RegisterRequest
from app.auth.security import hash_password
from app.auth.types import Plan, Role
from app.db.models_auth import User, UserSettings


class _ScalarResult:
    def __init__(self, value: User | None):
        self._value = value

    def scalar_one_or_none(self) -> User | None:
        return self._value


class FakeDb:
    def __init__(self, users: list[User] | None = None):
        self.users = list(users or [])
        self.user_settings: list[UserSettings] = []

    def execute(self, stmt):
        criteria = list(getattr(stmt, "_where_criteria", []))
        if not criteria:
            return _ScalarResult(None)

        expr = criteria[0]
        key = getattr(expr.left, "key", None)
        value = getattr(expr.right, "value", None)

        found = None
        if key:
            for user in self.users:
                if getattr(user, key) == value:
                    found = user
                    break

        return _ScalarResult(found)

    def add(self, obj):
        if isinstance(obj, User):
            self.users.append(obj)
            return
        if isinstance(obj, UserSettings):
            self.user_settings.append(obj)

    def commit(self):
        return None

    def refresh(self, _obj):
        return None


def _make_user(*, email: str, phone: str | None = None, google_sub: str | None = None, password: str = "Password123") -> User:
    return User(
        id=uuid.uuid4(),
        email=email,
        phone_number=phone,
        google_sub=google_sub,
        password_hash=hash_password(password),
        role=Role.USER,
        plan=Plan.FREE,
        is_active=True,
    )


def test_register_rejects_duplicate_email() -> None:
    db = FakeDb(users=[_make_user(email="athlete@example.com")])

    with pytest.raises(HTTPException) as exc:
        auth_endpoint.register(RegisterRequest(email="athlete@example.com", password="Password123"), db)

    assert exc.value.status_code == 409
    assert exc.value.detail == "Email already registered."


def test_register_and_login_with_phone_identifier() -> None:
    db = FakeDb()

    register_result = auth_endpoint.register(
        RegisterRequest(email="user@example.com", password="Password123", phone_number="+54 9 11 1234 5678"),
        db,
    )

    assert register_result.user.phone_number == "+5491112345678"
    assert len(db.user_settings) == 1

    login_result = auth_endpoint.login(
        LoginRequest(identifier="+54 9 11 1234 5678", password="Password123"),
        db,
    )

    assert login_result.user.id == register_result.user.id


def test_login_rejects_invalid_password() -> None:
    db = FakeDb(users=[_make_user(email="user@example.com", password="Password123")])

    with pytest.raises(HTTPException) as exc:
        auth_endpoint.login(LoginRequest(identifier="user@example.com", password="WrongPass999"), db)

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid credentials."


def test_login_rejects_unknown_password_hash_without_500() -> None:
    user = _make_user(email="legacy@example.com", password="Password123")
    user.password_hash = "legacy-unsupported-hash"
    db = FakeDb(users=[user])

    with pytest.raises(HTTPException) as exc:
        auth_endpoint.login(LoginRequest(identifier="legacy@example.com", password="Password123"), db)

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid credentials."


def test_validate_google_identity_requires_server_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_endpoint.settings, "google_client_id", None)

    with pytest.raises(HTTPException) as exc:
        auth_endpoint._validate_google_identity("x" * 32)

    assert exc.value.status_code == 503
    assert exc.value.detail == "Google login is not configured."


def test_validate_google_identity_accepts_valid_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_endpoint.settings, "google_client_id", "google-client-id")
    monkeypatch.setattr(
        auth_endpoint,
        "_fetch_google_tokeninfo",
        lambda _token: {
            "aud": "google-client-id",
            "email": "athlete@example.com",
            "sub": "google-sub-001",
            "email_verified": "true",
        },
    )

    email, sub = auth_endpoint._validate_google_identity("x" * 32)

    assert email == "athlete@example.com"
    assert sub == "google-sub-001"


def test_google_login_links_existing_email(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = _make_user(email="athlete@example.com")
    db = FakeDb(users=[existing])
    monkeypatch.setattr(auth_endpoint, "_validate_google_identity", lambda _token: ("athlete@example.com", "g-sub-123"))

    result = auth_endpoint.google_login(GoogleLoginRequest(id_token="x" * 32), db)

    assert result.user.email == "athlete@example.com"
    assert existing.google_sub == "g-sub-123"


def test_google_login_creates_user_when_email_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeDb(users=[])
    monkeypatch.setattr(auth_endpoint, "_validate_google_identity", lambda _token: ("new@example.com", "g-sub-new"))

    result = auth_endpoint.google_login(GoogleLoginRequest(id_token="x" * 32), db)

    assert result.user.email == "new@example.com"
    assert result.user.phone_number is None
    assert len(db.users) == 1
    assert len(db.user_settings) == 1


def test_guest_login_creates_debug_user_in_non_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeDb(users=[])
    monkeypatch.setattr(auth_endpoint.settings, "env", "dev")

    result = auth_endpoint.guest_login(db)

    assert result.user.email == auth_endpoint.DEBUG_GUEST_EMAIL
    assert len(db.users) == 1
    assert len(db.user_settings) == 1


def test_guest_login_is_disabled_in_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeDb(users=[])
    monkeypatch.setattr(auth_endpoint.settings, "env", "prod")

    with pytest.raises(HTTPException) as exc:
        auth_endpoint.guest_login(db)

    assert exc.value.status_code == 403
    assert exc.value.detail == "Guest login is disabled in production."
