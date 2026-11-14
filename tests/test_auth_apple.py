"""Sign in with Apple (verificacion del identity token, vinculo, revocacion) y Google iOS."""

from __future__ import annotations

import io
import json
import time
import uuid
from datetime import UTC, datetime
from urllib.error import URLError

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwk, jwt
from sqlalchemy.sql.dml import Delete, Update

import app.api.v1.endpoints.auth as auth_endpoint
from app.api.v1.endpoints.auth import AppleLoginRequest, DeleteAccountRequest
from app.auth.security import hash_password
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models_auth import User, UserSettings
from app.main import create_app

BUNDLE_ID = "com.santiagoquiceno.alzo"
KID = "test-kid"


def _rsa_private_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


APPLE_PRIVATE_PEM = _rsa_private_pem()
OTHER_PRIVATE_PEM = _rsa_private_pem()
# El fixture autouse reemplaza el fetch del JWKS; esta referencia permite probar el real.
REAL_FETCH_APPLE_JWKS = auth_endpoint._fetch_apple_jwks


def _public_jwk(private_pem: str, kid: str) -> dict:
    public = jwk.construct(private_pem, "RS256").public_key().to_dict()
    return {**public, "kid": kid, "use": "sig"}


def _apple_token(
    *,
    sub: str = "001234.apple-sub.0001",
    email: str | None = "athlete@privaterelay.appleid.com",
    aud: str = BUNDLE_ID,
    iss: str = "https://appleid.apple.com",
    exp_in: int = 600,
    key: str = APPLE_PRIVATE_PEM,
    kid: str = KID,
    extra: dict | None = None,
) -> str:
    now = int(time.time())
    claims: dict = {"iss": iss, "aud": aud, "sub": sub, "iat": now - 5, "exp": now + exp_in}
    if email is not None:
        claims.update({"email": email, "email_verified": "true", "is_private_email": "true"})
    claims.update(extra or {})
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return [] if self._value is None else [self._value]


class FakeDb:
    def __init__(self, users: list[User] | None = None):
        self.users = list(users or [])
        self.user_settings: list[UserSettings] = []
        self.deletes = 0
        self.commits = 0

    def execute(self, stmt):
        if isinstance(stmt, (Delete, Update)):
            self.deletes += 1
            return _ScalarResult(None)
        expr = list(stmt._where_criteria)[0]
        key = expr.left.key
        value = expr.right.value
        # Solo modela usuarios: consultas a otras tablas (billing, atletas) salen vacias.
        return _ScalarResult(next((u for u in self.users if getattr(u, key, None) == value), None))

    def add(self, obj):
        if isinstance(obj, User):
            self.users.append(obj)
        elif isinstance(obj, UserSettings):
            self.user_settings.append(obj)

    def commit(self):
        self.commits += 1

    def rollback(self):
        return None

    def refresh(self, _obj):
        return None


def _make_user(*, email: str, apple_sub: str | None = None, apple_refresh_token: str | None = None) -> User:
    return User(
        id=uuid.uuid4(),
        email=email,
        phone_number=None,
        google_sub=None,
        apple_sub=apple_sub,
        apple_refresh_token=apple_refresh_token,
        password_hash=hash_password("Password123"),
        role=Role.USER,
        plan=Plan.FREE,
        is_active=True,
    )


@pytest.fixture(autouse=True)
def apple_setup(monkeypatch: pytest.MonkeyPatch) -> dict:
    """JWKS mockeado (sin red), cache limpia y sin credenciales de revocacion."""
    state = {"fetches": 0, "keys": {KID: _public_jwk(APPLE_PRIVATE_PEM, KID)}}

    def fake_fetch() -> dict:
        state["fetches"] += 1
        return dict(state["keys"])

    monkeypatch.setattr(auth_endpoint, "_fetch_apple_jwks", fake_fetch)
    monkeypatch.setattr(auth_endpoint, "_apple_jwks_cache", {"keys": {}, "fetched_at": None})
    monkeypatch.setattr(auth_endpoint.settings, "apple_client_ids", [BUNDLE_ID])
    monkeypatch.setattr(auth_endpoint.settings, "apple_team_id", None)
    monkeypatch.setattr(auth_endpoint.settings, "apple_key_id", None)
    monkeypatch.setattr(auth_endpoint.settings, "apple_private_key", None)

    def no_network(*_args, **_kwargs):
        raise AssertionError("unexpected call to Apple")

    monkeypatch.setattr(auth_endpoint, "_post_apple_form", no_network)
    return state


@pytest.fixture
def apple_revocation_config(monkeypatch: pytest.MonkeyPatch) -> ec.EllipticCurvePrivateKey:
    ec_key = ec.generate_private_key(ec.SECP256R1())
    pem = ec_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    monkeypatch.setattr(auth_endpoint.settings, "apple_team_id", "TEAM123456")
    monkeypatch.setattr(auth_endpoint.settings, "apple_key_id", "KEY1234567")
    # Como llega desde una sola linea de .env: saltos de linea escapados.
    monkeypatch.setattr(auth_endpoint.settings, "apple_private_key", pem.replace("\n", "\\n"))
    return ec_key


def _expect_401(token: str) -> HTTPException:
    with pytest.raises(HTTPException) as exc:
        auth_endpoint._validate_apple_identity(token)
    assert exc.value.status_code == 401
    return exc.value


# --- verificacion del identity token ---------------------------------------------------


def test_valid_apple_token_creates_user_and_settings() -> None:
    db = FakeDb()

    result = auth_endpoint.apple_login(
        AppleLoginRequest(identity_token=_apple_token(), full_name="  Ana Atleta  ", accepted_legal_version="2026-10-28"),
        db,
    )

    assert result.user.email == "athlete@privaterelay.appleid.com"
    assert result.token.access_token
    assert len(db.users) == 1 and len(db.user_settings) == 1
    assert db.users[0].apple_sub == "001234.apple-sub.0001"
    assert db.users[0].apple_refresh_token is None
    assert db.user_settings[0].profile_display_name == "Ana Atleta"
    assert db.user_settings[0].modules_enabled == auth_endpoint._default_modules_for_plan(Plan.FREE)


def test_wrong_audience_is_rejected() -> None:
    err = _expect_401(_apple_token(aud="com.someone.else"))
    assert err.detail == "Invalid Apple token audience."


def test_audience_list_accepts_any_configured_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_endpoint.settings, "apple_client_ids", ["com.alzo.web", BUNDLE_ID])

    sub, email, client_id = auth_endpoint._validate_apple_identity(_apple_token())

    assert client_id == BUNDLE_ID
    assert sub == "001234.apple-sub.0001"
    assert email == "athlete@privaterelay.appleid.com"


def test_wrong_issuer_is_rejected() -> None:
    _expect_401(_apple_token(iss="https://evil.example.com"))


def test_expired_token_is_rejected() -> None:
    _expect_401(_apple_token(exp_in=-30))


def test_token_signed_with_other_key_is_rejected() -> None:
    _expect_401(_apple_token(key=OTHER_PRIVATE_PEM))


def test_hs256_token_is_rejected() -> None:
    # Confusion de algoritmo: HS256 firmado con "algo publico" no debe pasar.
    now = int(time.time())
    forged = jwt.encode(
        {"iss": "https://appleid.apple.com", "aud": BUNDLE_ID, "sub": "x", "iat": now, "exp": now + 600},
        "secret",
        algorithm="HS256",
        headers={"kid": KID},
    )
    _expect_401(forged)


def test_garbage_token_is_rejected() -> None:
    _expect_401("not-a-jwt-at-all-but-long-enough")


def test_unverified_email_is_ignored() -> None:
    token = _apple_token(
        email="someone@example.com",
        extra={"email_verified": "false", "is_private_email": "false"},
    )
    _, email, _ = auth_endpoint._validate_apple_identity(token)
    assert email is None


def test_unknown_kid_refetches_jwks_once(apple_setup: dict) -> None:
    auth_endpoint._validate_apple_identity(_apple_token())
    assert apple_setup["fetches"] == 1

    # Apple rota claves: kid nuevo -> refetch (pasado el intervalo minimo).
    apple_setup["keys"]["rotated-kid"] = _public_jwk(OTHER_PRIVATE_PEM, "rotated-kid")
    auth_endpoint._apple_jwks_cache["fetched_at"] -= auth_endpoint.APPLE_JWKS_MIN_REFETCH_SECONDS + 1
    auth_endpoint._validate_apple_identity(_apple_token(key=OTHER_PRIVATE_PEM, kid="rotated-kid"))
    assert apple_setup["fetches"] == 2

    # Kid desconocido justo despues: no se vuelve a pedir el JWKS (anti-abuso).
    _expect_401(_apple_token(kid="never-seen"))
    assert apple_setup["fetches"] == 2


def test_fetch_apple_jwks_parses_keys_and_maps_network_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.dumps({"keys": [_public_jwk(APPLE_PRIVATE_PEM, "k1")]}).encode()
    monkeypatch.setattr(auth_endpoint, "urlopen", lambda url, timeout: io.BytesIO(body))

    keys = REAL_FETCH_APPLE_JWKS()
    assert list(keys) == ["k1"]

    def offline(url, timeout):
        raise URLError("offline")

    monkeypatch.setattr(auth_endpoint, "urlopen", offline)
    with pytest.raises(HTTPException) as exc:
        REAL_FETCH_APPLE_JWKS()
    assert exc.value.status_code == 502


# --- vinculo de cuentas -----------------------------------------------------------------


def test_second_login_without_email_finds_user_by_apple_sub() -> None:
    db = FakeDb()
    first = auth_endpoint.apple_login(AppleLoginRequest(identity_token=_apple_token(), accepted_legal_version="2026-10-28"), db)

    second = auth_endpoint.apple_login(AppleLoginRequest(identity_token=_apple_token(email=None)), db)

    assert second.user.id == first.user.id
    assert len(db.users) == 1


def test_first_login_without_email_is_rejected() -> None:
    with pytest.raises(HTTPException) as exc:
        auth_endpoint.apple_login(AppleLoginRequest(identity_token=_apple_token(email=None)), FakeDb())
    assert exc.value.status_code == 401
    assert exc.value.detail == "Apple token has no email."


def test_apple_login_links_existing_email_account() -> None:
    existing = _make_user(email="athlete@example.com")
    db = FakeDb(users=[existing])

    result = auth_endpoint.apple_login(
        AppleLoginRequest(identity_token=_apple_token(email="athlete@example.com")),
        db,
    )

    assert result.user.id == str(existing.id)
    assert existing.apple_sub == "001234.apple-sub.0001"
    assert len(db.users) == 1


def test_apple_new_user_records_legal_consent() -> None:
    db = FakeDb()

    auth_endpoint.apple_login(
        AppleLoginRequest(identity_token=_apple_token(), accepted_legal_version="2026-10-28"),
        db,
    )

    assert db.users[0].legal_version == "2026-10-28"
    assert db.users[0].legal_accepted_at is not None


def test_apple_login_of_existing_user_keeps_original_consent() -> None:
    existing = _make_user(email="athlete@example.com")
    existing.legal_version = "2025-01-01"
    accepted_at = existing.legal_accepted_at = datetime(2025, 1, 1, tzinfo=UTC)
    db = FakeDb(users=[existing])

    auth_endpoint.apple_login(
        AppleLoginRequest(
            identity_token=_apple_token(email="athlete@example.com"), accepted_legal_version="2026-10-28"
        ),
        db,
    )

    assert existing.apple_sub == "001234.apple-sub.0001"
    assert (existing.legal_version, existing.legal_accepted_at) == ("2025-01-01", accepted_at)


def test_apple_login_rejects_email_linked_to_other_apple_account() -> None:
    db = FakeDb(users=[_make_user(email="athlete@example.com", apple_sub="other-apple-sub")])

    with pytest.raises(HTTPException) as exc:
        auth_endpoint.apple_login(
            AppleLoginRequest(identity_token=_apple_token(email="athlete@example.com")),
            db,
        )
    assert exc.value.status_code == 409


def test_apple_endpoint_is_routed() -> None:
    app = create_app()
    db = FakeDb()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    ok = client.post("/api/v1/auth/apple", json={"identity_token": _apple_token(), "accepted_legal_version": "2026-10-28"})
    bad = client.post("/api/v1/auth/apple", json={"identity_token": _apple_token(aud="com.evil.app")})

    assert ok.status_code == 200
    assert ok.json()["user"]["email"] == "athlete@privaterelay.appleid.com"
    assert bad.status_code == 401


# --- canje de authorization_code y revocacion -----------------------------------------


def test_login_with_code_stores_refresh_token_using_valid_client_secret(
    monkeypatch: pytest.MonkeyPatch, apple_revocation_config: ec.EllipticCurvePrivateKey
) -> None:
    calls: list[tuple[str, dict]] = []

    def fake_post(url: str, data: dict) -> dict:
        calls.append((url, data))
        return {"refresh_token": "apple-refresh-123", "access_token": "a", "id_token": "i"}

    monkeypatch.setattr(auth_endpoint, "_post_apple_form", fake_post)
    db = FakeDb()

    auth_endpoint.apple_login(
        AppleLoginRequest(identity_token=_apple_token(), authorization_code="auth-code-xyz", accepted_legal_version="2026-10-28"),
        db,
    )

    assert db.users[0].apple_refresh_token == "apple-refresh-123"
    [(url, data)] = calls
    assert url == auth_endpoint.APPLE_TOKEN_URL
    assert data["grant_type"] == "authorization_code"
    assert data["code"] == "auth-code-xyz"
    assert data["client_id"] == BUNDLE_ID

    public_pem = apple_revocation_config.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    secret_claims = jwt.decode(
        data["client_secret"],
        public_pem.decode(),
        algorithms=["ES256"],
        audience="https://appleid.apple.com",
        issuer="TEAM123456",
    )
    assert secret_claims["sub"] == BUNDLE_ID
    assert jwt.get_unverified_header(data["client_secret"])["kid"] == "KEY1234567"


def test_login_with_code_but_no_config_skips_exchange() -> None:
    db = FakeDb()  # _post_apple_form explota si se llama (fixture autouse)

    auth_endpoint.apple_login(
        AppleLoginRequest(identity_token=_apple_token(), authorization_code="auth-code-xyz", accepted_legal_version="2026-10-28"),
        db,
    )

    assert db.users[0].apple_refresh_token is None


def test_failed_code_exchange_does_not_block_login(
    monkeypatch: pytest.MonkeyPatch, apple_revocation_config: ec.EllipticCurvePrivateKey
) -> None:
    def offline(url: str, data: dict) -> dict:
        raise URLError("offline")

    monkeypatch.setattr(auth_endpoint, "_post_apple_form", offline)
    db = FakeDb()

    result = auth_endpoint.apple_login(
        AppleLoginRequest(identity_token=_apple_token(), authorization_code="auth-code-xyz", accepted_legal_version="2026-10-28"),
        db,
    )

    assert result.token.access_token
    assert db.users[0].apple_refresh_token is None


def test_delete_account_with_config_revokes_apple_token(
    monkeypatch: pytest.MonkeyPatch, apple_revocation_config: ec.EllipticCurvePrivateKey
) -> None:
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(auth_endpoint, "_post_apple_form", lambda url, data: calls.append((url, data)) or {})
    user = _make_user(email="a@privaterelay.appleid.com", apple_sub="s", apple_refresh_token="rt-1")
    db = FakeDb(users=[user])

    assert auth_endpoint.delete_my_account(DeleteAccountRequest(confirm="ELIMINAR CUENTA"), user, db) == {"ok": True}

    [(url, data)] = calls
    assert url == auth_endpoint.APPLE_REVOKE_URL
    assert data["token"] == "rt-1"
    assert data["token_type_hint"] == "refresh_token"
    assert data["client_id"] == BUNDLE_ID
    assert db.commits == 1 and db.deletes > 0


def test_delete_account_without_config_skips_revoke() -> None:
    # Sin APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY: _post_apple_form (que explota) no se llama.
    user = _make_user(email="a@privaterelay.appleid.com", apple_sub="s", apple_refresh_token="rt-1")
    db = FakeDb(users=[user])

    assert auth_endpoint.delete_my_account(DeleteAccountRequest(confirm="ELIMINAR CUENTA"), user, db) == {"ok": True}
    assert db.commits == 1


def test_delete_account_still_deletes_when_revoke_fails(
    monkeypatch: pytest.MonkeyPatch, apple_revocation_config: ec.EllipticCurvePrivateKey
) -> None:
    def offline(url: str, data: dict) -> dict:
        raise URLError("offline")

    monkeypatch.setattr(auth_endpoint, "_post_apple_form", offline)
    user = _make_user(email="a@privaterelay.appleid.com", apple_sub="s", apple_refresh_token="rt-1")
    db = FakeDb(users=[user])

    assert auth_endpoint.delete_my_account(DeleteAccountRequest(confirm="ELIMINAR CUENTA"), user, db) == {"ok": True}
    assert db.commits == 1 and db.deletes > 0


# --- Google en iOS ----------------------------------------------------------------------


def _google_payload(aud: str) -> dict[str, str]:
    return {"aud": aud, "email": "athlete@example.com", "sub": "g-sub", "email_verified": "true"}


def test_google_accepts_ios_client_audience(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_endpoint.settings, "google_client_id", "web-client.apps.googleusercontent.com")
    monkeypatch.setattr(auth_endpoint.settings, "google_ios_client_id", "ios-client.apps.googleusercontent.com")
    monkeypatch.setattr(
        auth_endpoint, "_fetch_google_tokeninfo", lambda _t: _google_payload("ios-client.apps.googleusercontent.com")
    )

    assert auth_endpoint._validate_google_identity("x" * 32) == ("athlete@example.com", "g-sub")


def test_google_still_accepts_web_audience_and_rejects_others(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_endpoint.settings, "google_client_id", "web-client.apps.googleusercontent.com")
    monkeypatch.setattr(auth_endpoint.settings, "google_ios_client_id", None)
    monkeypatch.setattr(
        auth_endpoint, "_fetch_google_tokeninfo", lambda _t: _google_payload("web-client.apps.googleusercontent.com")
    )
    assert auth_endpoint._validate_google_identity("x" * 32)[1] == "g-sub"

    monkeypatch.setattr(
        auth_endpoint, "_fetch_google_tokeninfo", lambda _t: _google_payload("ios-client.apps.googleusercontent.com")
    )
    with pytest.raises(HTTPException) as exc:
        auth_endpoint._validate_google_identity("x" * 32)
    assert exc.value.status_code == 401


def test_apple_new_user_without_consent_is_rejected_and_nothing_is_created() -> None:
    db = FakeDb()

    with pytest.raises(HTTPException) as exc:
        auth_endpoint.apple_login(
            AppleLoginRequest(identity_token=_apple_token(), authorization_code="auth-code-xyz"), db
        )

    assert exc.value.status_code == 428
    assert exc.value.detail == auth_endpoint.LEGAL_CONSENT_REQUIRED
    assert db.users == []
