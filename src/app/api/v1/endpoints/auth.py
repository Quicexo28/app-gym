from __future__ import annotations

import json
import logging
import re
import secrets
import threading
import time
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import stripe
from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException
from jose import jwt
from jose.exceptions import JOSEError
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, delete, exists, or_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, aliased

from app.auth.athlete_access import personal_athlete_id_for_user
from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.auth.types import Plan, Role
from app.auth.view_scopes import can_use_admin_view, can_use_coach_view
from app.core.config import Settings
from app.db.engine import get_db
from app.db.models import (
    ActiveSessionHeartbeat,
    Athlete,
    AthletePlan,
    BodyMeasurement,
    CoachAthleteAssignment,
    CoachNote,
    CoachReport,
    CycleAssignment,
    CycleTemplate,
    ExerciseCatalog,
    FoodProduct,
    MealEntry,
    MealPreset,
    NutritionTarget,
    PredictionLog,
    ProgressShare,
    ProgressShareComment,
    RoutineStore,
    RoutineTemplateExerciseIndex,
    Run,
    TrainingSession,
)
from app.db.models_auth import User, UserSettings
from app.db.models_coach import CoachBilling, CoachBillingStatus, CoachProfile
from app.nutrition.media import remove_food_photos

router = APIRouter(prefix="/auth", tags=["auth"])
DbSession = Session
settings = Settings()
logger = logging.getLogger(__name__)

PHONE_MIN_DIGITS = 8
PHONE_MAX_DIGITS = 15
PHONE_DIGITS_RE = re.compile(r"\D+")
DEBUG_GUEST_EMAIL = "invitado.debug@coach.local"
# Atletas sin cuenta propia que crea un coach (ver coach_athletes.create_coach_athlete).
MANAGED_ATHLETE_PREFIX = "coach_"

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"
APPLE_JWKS_TTL_SECONDS = 6 * 60 * 60
# Un `kid` desconocido fuerza refetch, pero no mas de uno por minuto (evita que
# tokens basura conviertan cada request en una llamada a Apple).
APPLE_JWKS_MIN_REFETCH_SECONDS = 60
_apple_jwks_cache: dict[str, Any] = {"keys": {}, "fetched_at": None}
_apple_jwks_lock = threading.Lock()


# Version de Terminos/Politica que el usuario acepto (LEGAL_VERSION del frontend). Opcional
# solo por clientes PWA viejos en cache: sin ella la cuenta se crea sin registro de consentimiento.
LegalVersion = Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[0-9A-Za-z._-]+$")]


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    phone_number: str | None = Field(default=None, min_length=7, max_length=32)
    accepted_legal_version: LegalVersion | None = None


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=20, max_length=4096)
    accepted_legal_version: LegalVersion | None = None


class AppleLoginRequest(BaseModel):
    identity_token: str = Field(min_length=20, max_length=4096)
    authorization_code: str | None = Field(default=None, max_length=1024)
    # Apple solo manda el nombre en la primera autorizacion. El email NO se acepta del
    # cliente: sale del identity token firmado (si no, cualquiera vincularia cuentas ajenas).
    full_name: str | None = Field(default=None, max_length=128)
    accepted_legal_version: LegalVersion | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    phone_number: str | None
    role: Role
    plan: Plan
    can_admin_view: bool
    can_coach_view: bool


class AuthResponse(BaseModel):
    token: TokenResponse
    user: UserResponse


class DeleteAccountRequest(BaseModel):
    confirm: str = Field(min_length=1, max_length=64)


def _normalize_email(raw: str) -> str:
    try:
        validated = validate_email(raw, check_deliverability=False)
        return validated.normalized
    except EmailNotValidError as err:
        raise HTTPException(status_code=400, detail="Invalid email.") from err


def _normalize_phone(raw: str) -> str:
    digits = PHONE_DIGITS_RE.sub("", raw.strip())
    if not digits or len(digits) < PHONE_MIN_DIGITS or len(digits) > PHONE_MAX_DIGITS:
        raise HTTPException(status_code=400, detail="Invalid phone number.")
    return f"+{digits}"


def _normalize_identifier(raw: str) -> tuple[str, str]:
    identifier = raw.strip()
    if "@" in identifier:
        return "email", _normalize_email(identifier)
    return "phone", _normalize_phone(identifier)


def _auth_response_for_user(user: User) -> AuthResponse:
    token = create_access_token(sub=str(user.id), role=user.role, plan=user.plan)
    return AuthResponse(
        token=TokenResponse(access_token=token),
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            phone_number=user.phone_number,
            role=user.role,
            plan=user.plan,
            can_admin_view=can_use_admin_view(user),
            can_coach_view=can_use_coach_view(user),
        ),
    )


def _default_modules_for_plan(plan: Plan) -> dict:
    # Free: minimal set to avoid overload; Pro/Coach: all modules available.
    if plan == Plan.FREE:
        return {"trends": True, "latents": False, "suggestions": True, "validation": False}
    return {"trends": True, "latents": True, "suggestions": True, "validation": True}


def _is_guest_login_enabled() -> bool:
    return settings.env.strip().lower() != "prod"


def _fetch_google_tokeninfo(id_token: str) -> dict[str, str]:
    query = urlencode({"id_token": id_token})
    url = f"https://oauth2.googleapis.com/tokeninfo?{query}"
    try:
        with urlopen(url, timeout=8) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as err:
        raise HTTPException(status_code=401, detail="Invalid Google token.") from err
    except URLError as err:
        raise HTTPException(status_code=502, detail="Could not validate Google token.") from err

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=502, detail="Could not validate Google token.") from err

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Could not validate Google token.")
    return {str(k): str(v) for k, v in payload.items()}


def _validate_google_identity(id_token: str) -> tuple[str, str]:
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google login is not configured.")

    payload = _fetch_google_tokeninfo(id_token)
    # Web/Android firman con el client ID web; la app iOS con su client ID iOS.
    allowed_audiences = {settings.google_client_id, settings.google_ios_client_id} - {None, ""}
    token_audience = payload.get("aud")
    if token_audience not in allowed_audiences:
        raise HTTPException(status_code=401, detail="Invalid Google token audience.")

    email = payload.get("email", "").strip()
    sub = payload.get("sub", "").strip()
    email_verified = payload.get("email_verified", "").lower() == "true"

    if not email or not sub or not email_verified:
        raise HTTPException(status_code=401, detail="Invalid Google token payload.")

    return _normalize_email(email), sub


def _fetch_apple_jwks() -> dict[str, dict]:
    try:
        with urlopen(APPLE_KEYS_URL, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError) as err:
        raise HTTPException(status_code=502, detail="Could not validate Apple token.") from err

    keys = payload.get("keys") if isinstance(payload, dict) else None
    if not isinstance(keys, list):
        raise HTTPException(status_code=502, detail="Could not validate Apple token.")
    return {str(key["kid"]): key for key in keys if isinstance(key, dict) and key.get("kid")}


def _apple_signing_key(kid: str) -> dict:
    now = time.monotonic()
    with _apple_jwks_lock:
        fetched_at = _apple_jwks_cache["fetched_at"]
        stale = fetched_at is None or now - fetched_at > APPLE_JWKS_TTL_SECONDS
        unknown_kid = kid not in _apple_jwks_cache["keys"]
        can_refetch = fetched_at is None or now - fetched_at > APPLE_JWKS_MIN_REFETCH_SECONDS
        if stale or (unknown_kid and can_refetch):
            _apple_jwks_cache["keys"] = _fetch_apple_jwks()
            _apple_jwks_cache["fetched_at"] = now
        key = _apple_jwks_cache["keys"].get(kid)

    if key is None:
        raise HTTPException(status_code=401, detail="Invalid Apple token.")
    return key


def _claim_is_true(value: Any) -> bool:
    # Apple manda estos claims a veces como bool y a veces como "true"/"false".
    return value is True or str(value).strip().lower() == "true"


def _validate_apple_identity(identity_token: str) -> tuple[str, str | None, str]:
    """Verifica el identity token de Apple y devuelve (sub, email|None, client_id).

    Firma RS256 contra el JWKS de Apple, `iss`, `exp` y `aud` en la lista permitida.
    """
    allowed_audiences = [cid for cid in settings.apple_client_ids if cid]
    if not allowed_audiences:
        raise HTTPException(status_code=503, detail="Apple login is not configured.")

    try:
        header = jwt.get_unverified_header(identity_token)
    except JOSEError as err:
        raise HTTPException(status_code=401, detail="Invalid Apple token.") from err

    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str) or not kid:
        raise HTTPException(status_code=401, detail="Invalid Apple token.")

    try:
        claims = jwt.decode(
            identity_token,
            _apple_signing_key(kid),
            algorithms=["RS256"],
            issuer=APPLE_ISSUER,
            # `aud` se valida abajo contra una lista (jose solo acepta un valor).
            options={
                "verify_aud": False,
                "verify_at_hash": False,
                "require_exp": True,
                "require_iat": True,
                "require_iss": True,
                "require_sub": True,
            },
        )
    except JOSEError as err:
        raise HTTPException(status_code=401, detail="Invalid Apple token.") from err

    token_audiences = claims.get("aud")
    if isinstance(token_audiences, str):
        token_audiences = [token_audiences]
    if not isinstance(token_audiences, list):
        raise HTTPException(status_code=401, detail="Invalid Apple token audience.")
    client_id = next((aud for aud in token_audiences if aud in allowed_audiences), None)
    if client_id is None:
        raise HTTPException(status_code=401, detail="Invalid Apple token audience.")

    sub = str(claims.get("sub") or "").strip()
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid Apple token payload.")

    email: str | None = None
    raw_email = str(claims.get("email") or "").strip()
    if raw_email and (
        _claim_is_true(claims.get("email_verified")) or _claim_is_true(claims.get("is_private_email"))
    ):
        email = _normalize_email(raw_email)

    return sub, email, client_id


def _apple_revocation_configured() -> bool:
    return bool(
        settings.apple_team_id
        and settings.apple_key_id
        and settings.apple_private_key
        and settings.apple_client_ids
    )


def _apple_client_secret(client_id: str) -> str:
    # client_secret = JWT ES256 firmado con la key .p8 (Apple acepta hasta 6 meses; usamos 5 min).
    now = int(time.time())
    private_key = (settings.apple_private_key or "").replace("\\n", "\n")
    return jwt.encode(
        {"iss": settings.apple_team_id, "iat": now, "exp": now + 300, "aud": APPLE_ISSUER, "sub": client_id},
        private_key,
        algorithm="ES256",
        headers={"kid": settings.apple_key_id},
    )


def _post_apple_form(url: str, data: dict[str, str]) -> dict:
    request = Request(
        url,
        data=urlencode(data).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=8) as response:
        raw = response.read().decode("utf-8").strip()
    payload = json.loads(raw) if raw else {}
    return payload if isinstance(payload, dict) else {}


def _apple_error_label(err: Exception | None) -> str:
    # Nunca loguear el cuerpo ni la URL completa: pueden llevar tokens.
    if isinstance(err, HTTPError):
        return f"HTTP {err.code}"
    return type(err).__name__


def _exchange_apple_code(authorization_code: str, client_id: str) -> str | None:
    if not _apple_revocation_configured():
        logger.info("Apple code exchange skipped: APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY not set.")
        return None
    try:
        payload = _post_apple_form(
            APPLE_TOKEN_URL,
            {
                "client_id": client_id,
                "client_secret": _apple_client_secret(client_id),
                "code": authorization_code,
                "grant_type": "authorization_code",
            },
        )
    except (OSError, ValueError, JOSEError) as err:
        logger.warning("Apple code exchange failed (%s); login continues without refresh token.", _apple_error_label(err))
        return None

    refresh_token = payload.get("refresh_token")
    return refresh_token if isinstance(refresh_token, str) and refresh_token else None


def _revoke_apple_token(refresh_token: str) -> None:
    """Revoca el refresh token en Apple. Nunca lanza: borrar la cuenta no depende de esto."""
    if not _apple_revocation_configured():
        logger.info("Apple token revocation skipped: APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY not set.")
        return

    # El token se emitio para uno de los client IDs permitidos; Apple rechaza los demas.
    last_error: Exception | None = None
    for client_id in settings.apple_client_ids:
        try:
            _post_apple_form(
                APPLE_REVOKE_URL,
                {
                    "client_id": client_id,
                    "client_secret": _apple_client_secret(client_id),
                    "token": refresh_token,
                    "token_type_hint": "refresh_token",
                },
            )
            return
        except (OSError, ValueError, JOSEError) as err:
            last_error = err
    logger.warning("Apple token revocation failed (%s); deleting account anyway.", _apple_error_label(last_error))


def _legal_consent(accepted_legal_version: str | None) -> dict[str, Any]:
    """Columnas de consentimiento de una cuenta nueva; la fecha es la del servidor."""
    if not accepted_legal_version:
        return {}
    return {"legal_version": accepted_legal_version, "legal_accepted_at": datetime.now(UTC)}


def _add_social_user(
    db: DbSession,
    *,
    email: str,
    google_sub: str | None = None,
    apple_sub: str | None = None,
    display_name: str | None = None,
    accepted_legal_version: str | None = None,
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        phone_number=None,
        google_sub=google_sub,
        apple_sub=apple_sub,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        role=Role.USER,
        plan=Plan.FREE,
        is_active=True,
        **_legal_consent(accepted_legal_version),
    )
    db.add(user)
    db.add(
        UserSettings(
            user_id=user.id,
            weight_unit="kg",
            effort_mode="rpe",
            modules_enabled=_default_modules_for_plan(user.plan),
            profile_display_name=display_name,
        )
    )
    return user


@router.post("/register", response_model=AuthResponse)
def register(
    payload: RegisterRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    email = _normalize_email(payload.email)
    phone_number = _normalize_phone(payload.phone_number) if payload.phone_number else None

    existing_email = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing_email is not None:
        raise HTTPException(status_code=409, detail="Email already registered.")

    if phone_number:
        existing_phone = db.execute(select(User).where(User.phone_number == phone_number)).scalar_one_or_none()
        if existing_phone is not None:
            raise HTTPException(status_code=409, detail="Phone already registered.")

    user = User(
        id=uuid.uuid4(),
        email=email,
        phone_number=phone_number,
        password_hash=hash_password(payload.password),
        role=Role.USER,
        plan=Plan.FREE,
        is_active=True,
        **_legal_consent(payload.accepted_legal_version),
    )
    db.add(user)
    db.add(
        UserSettings(
            user_id=user.id,
            weight_unit="kg",
            effort_mode="rpe",
            modules_enabled=_default_modules_for_plan(user.plan),
        )
    )
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or phone already registered.") from err
    db.refresh(user)

    return _auth_response_for_user(user)


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    identifier_type, normalized_identifier = _normalize_identifier(payload.identifier)
    if identifier_type == "email":
        user = db.execute(select(User).where(User.email == normalized_identifier)).scalar_one_or_none()
    else:
        user = db.execute(select(User).where(User.phone_number == normalized_identifier)).scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    return _auth_response_for_user(user)


@router.post("/guest", response_model=AuthResponse)
def guest_login(
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    if not _is_guest_login_enabled():
        raise HTTPException(status_code=403, detail="Guest login is disabled in production.")

    user = db.execute(select(User).where(User.email == DEBUG_GUEST_EMAIL)).scalar_one_or_none()
    if user is None:
        user = User(
            id=uuid.uuid4(),
            email=DEBUG_GUEST_EMAIL,
            phone_number=None,
            google_sub=None,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            role=Role.USER,
            plan=Plan.FREE,
            is_active=True,
        )
        db.add(user)
        db.add(
            UserSettings(
                user_id=user.id,
                weight_unit="kg",
                effort_mode="rpe",
                modules_enabled=_default_modules_for_plan(user.plan),
            )
        )
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            user = db.execute(select(User).where(User.email == DEBUG_GUEST_EMAIL)).scalar_one_or_none()
            if user is None:
                raise HTTPException(status_code=500, detail="Could not create guest user.") from None
        except SQLAlchemyError as err:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail="Guest login failed. Ensure database migrations are up to date.",
            ) from err

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Guest user is inactive.")

    return _auth_response_for_user(user)


@router.post("/google", response_model=AuthResponse)
def google_login(
    payload: GoogleLoginRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    email, google_sub = _validate_google_identity(payload.id_token)

    user = db.execute(select(User).where(User.google_sub == google_sub)).scalar_one_or_none()
    should_commit = False

    if user is None:
        user_by_email = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user_by_email is not None:
            if user_by_email.google_sub and user_by_email.google_sub != google_sub:
                raise HTTPException(status_code=409, detail="Google account already linked.")
            user_by_email.google_sub = google_sub
            user = user_by_email
            should_commit = True
        else:
            user = _add_social_user(
                db, email=email, google_sub=google_sub, accepted_legal_version=payload.accepted_legal_version
            )
            should_commit = True

    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if should_commit:
        db.commit()
        db.refresh(user)

    return _auth_response_for_user(user)


@router.post("/apple", response_model=AuthResponse)
def apple_login(
    payload: AppleLoginRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    apple_sub, email, client_id = _validate_apple_identity(payload.identity_token)

    user = db.execute(select(User).where(User.apple_sub == apple_sub)).scalar_one_or_none()

    if user is None:
        # Sin cuenta vinculada hace falta el email del token para vincular o crear.
        if not email:
            raise HTTPException(status_code=401, detail="Apple token has no email.")
        user_by_email = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user_by_email is not None:
            if user_by_email.apple_sub and user_by_email.apple_sub != apple_sub:
                raise HTTPException(status_code=409, detail="Apple account already linked.")
            user_by_email.apple_sub = apple_sub
            user = user_by_email
        else:
            display_name = (payload.full_name or "").strip()[:64] or None
            user = _add_social_user(
                db,
                email=email,
                apple_sub=apple_sub,
                display_name=display_name,
                accepted_legal_version=payload.accepted_legal_version,
            )

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if payload.authorization_code:
        refresh_token = _exchange_apple_code(payload.authorization_code, client_id)
        if refresh_token:
            user.apple_refresh_token = refresh_token

    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(status_code=409, detail="Apple account already linked.") from err
    db.refresh(user)

    return _auth_response_for_user(user)


def _managed_athlete_ids(db: DbSession, coach: User) -> list[str]:
    """Atletas sin cuenta (`coach_*`) de este coach que ningun otro coach lleva.

    Solo existen dentro de su cartera, asi que se borran con su cuenta. Si un admin
    tambien se los asigno a otro coach se quedan; solo cae el vinculo con este.
    """
    other = aliased(CoachAthleteAssignment)
    return list(
        db.execute(
            select(CoachAthleteAssignment.athlete_id).where(
                CoachAthleteAssignment.coach_user_id == coach.id,
                CoachAthleteAssignment.athlete_id.startswith(MANAGED_ATHLETE_PREFIX, autoescape=True),
                ~exists().where(
                    other.athlete_id == CoachAthleteAssignment.athlete_id,
                    other.coach_user_id != coach.id,
                ),
            )
        )
        .scalars()
        .all()
    )


def _live_stripe_subscription_id(db: DbSession, user: User) -> str | None:
    # Columna suelta y status como texto: el Enum del modelo manda nombres ("ACTIVE") y el
    # tipo de Postgres tiene valores ("active"), asi que cargar la entidad CoachBilling falla.
    return db.execute(
        select(CoachBilling.stripe_subscription_id).where(
            CoachBilling.coach_user_id == user.id,
            CoachBilling.stripe_subscription_id.is_not(None),
            cast(CoachBilling.status, String) != CoachBillingStatus.CANCELED.value,
        )
    ).scalar_one_or_none()


def _cancel_stripe_subscription(subscription_id: str) -> None:
    """Cancela ya la suscripcion del plan coach. Nunca lanza: borrar la cuenta no depende de esto."""
    if not settings.stripe_secret_key:
        logger.warning(
            "Stripe subscription cancel skipped: STRIPE_SECRET_KEY not set; cancel %s manually.", subscription_id
        )
        return
    try:
        stripe.Subscription.cancel(subscription_id, api_key=settings.stripe_secret_key)
    except (stripe.StripeError, OSError) as err:
        logger.warning(
            "Stripe subscription cancel failed (%s); deleting account anyway, cancel %s manually.",
            type(err).__name__,
            subscription_id,
        )


def _delete_account_rows(db: DbSession, user: User, athlete_ids: list[str]) -> list[uuid.UUID]:
    """Borra, sin commit, todo lo del usuario y de `athlete_ids`; devuelve los alimentos borrados.

    Cubre cada FK a users.id y athletes.athlete_id; casi ninguna tiene ON DELETE, por eso el
    orden importa. tests/test_account_deletion.py lo comprueba contra Postgres.
    """
    owned_template_ids = select(CycleTemplate.id).where(CycleTemplate.owner_user_id == user.id)

    # Planning primero: assignments (blocks caen por ON DELETE CASCADE) y luego templates.
    db.execute(
        delete(CycleAssignment).where(
            or_(
                CycleAssignment.athlete_id.in_(athlete_ids),
                CycleAssignment.assigned_by_user_id == user.id,
                CycleAssignment.template_id.in_(owned_template_ids),
            )
        )
    )
    db.execute(delete(CycleTemplate).where(CycleTemplate.owner_user_id == user.id))

    # Progreso compartido: los comentarios de otros sobre estos reportes caen por CASCADE.
    db.execute(delete(ProgressShareComment).where(ProgressShareComment.author_user_id == user.id))
    db.execute(
        delete(ProgressShare).where(
            or_(ProgressShare.athlete_id.in_(athlete_ids), ProgressShare.author_user_id == user.id)
        )
    )

    # Dieta. Los alimentos personales se borran; si otro usuario registro comidas con ellos,
    # esas comidas (snapshot congelado) solo pierden el vinculo. Los aportados al catalogo
    # compartido (owner NULL, con barcode) se quedan para todos, sin autor.
    db.execute(
        delete(MealEntry).where(
            or_(MealEntry.athlete_id.in_(athlete_ids), MealEntry.logged_by_user_id == user.id)
        )
    )
    owned_food_ids = select(FoodProduct.id).where(FoodProduct.owner_user_id == user.id)
    db.execute(
        update(MealEntry).where(MealEntry.food_product_id.in_(owned_food_ids)).values(food_product_id=None)
    )
    deleted_food_ids = list(
        db.execute(delete(FoodProduct).where(FoodProduct.owner_user_id == user.id).returning(FoodProduct.id))
        .scalars()
        .all()
    )
    db.execute(
        update(FoodProduct).where(FoodProduct.created_by_user_id == user.id).values(created_by_user_id=None)
    )
    db.execute(delete(MealPreset).where(MealPreset.owner_user_id == user.id))
    db.execute(delete(NutritionTarget).where(NutritionTarget.athlete_id.in_(athlete_ids)))
    db.execute(delete(PredictionLog).where(PredictionLog.athlete_id.in_(athlete_ids)))

    db.execute(
        delete(BodyMeasurement).where(
            or_(
                BodyMeasurement.athlete_id.in_(athlete_ids),
                BodyMeasurement.measured_by_user_id == user.id,
            )
        )
    )
    db.execute(delete(Run).where(Run.athlete_id.in_(athlete_ids)))
    db.execute(delete(TrainingSession).where(TrainingSession.athlete_id.in_(athlete_ids)))
    db.execute(
        delete(CoachNote).where(
            or_(
                CoachNote.athlete_id.in_(athlete_ids),
                CoachNote.author_user_id == user.id,
            )
        )
    )
    db.execute(delete(CoachReport).where(CoachReport.athlete_id.in_(athlete_ids)))
    db.execute(delete(AthletePlan).where(AthletePlan.athlete_id.in_(athlete_ids)))
    db.execute(
        delete(ActiveSessionHeartbeat).where(ActiveSessionHeartbeat.athlete_id.in_(athlete_ids))
    )
    db.execute(
        delete(RoutineTemplateExerciseIndex).where(
            or_(
                RoutineTemplateExerciseIndex.coach_user_id == user.id,
                RoutineTemplateExerciseIndex.athlete_id.in_(athlete_ids),
            )
        )
    )
    db.execute(
        delete(CoachAthleteAssignment).where(
            or_(
                CoachAthleteAssignment.coach_user_id == user.id,
                CoachAthleteAssignment.athlete_id.in_(athlete_ids),
            )
        )
    )
    db.execute(delete(Athlete).where(Athlete.athlete_id.in_(athlete_ids)))

    db.execute(delete(ExerciseCatalog).where(ExerciseCatalog.owner_user_id == user.id))
    db.execute(delete(RoutineStore).where(RoutineStore.user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.execute(delete(CoachProfile).where(CoachProfile.coach_user_id == user.id))
    db.execute(delete(CoachBilling).where(CoachBilling.coach_user_id == user.id))
    db.execute(delete(User).where(User.id == user.id))
    return deleted_food_ids


@router.delete("/me")
def delete_my_account(
    payload: DeleteAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    if payload.confirm.strip() != "ELIMINAR CUENTA":
        raise HTTPException(status_code=400, detail='Confirmacion invalida. Debe ser "ELIMINAR CUENTA".')

    # Apple exige revocar el token de Sign in with Apple al borrar la cuenta.
    if user.apple_refresh_token:
        _revoke_apple_token(user.apple_refresh_token)
    elif user.apple_sub:
        logger.info("Apple token revocation skipped: no refresh token stored for this user.")

    user_id = user.id
    # Una sola transaccion: si algo falla no se borra nada.
    try:
        subscription_id = _live_stripe_subscription_id(db, user)
        if subscription_id:
            _cancel_stripe_subscription(subscription_id)

        athlete_ids = [personal_athlete_id_for_user(user), *_managed_athlete_ids(db, user)]
        deleted_food_ids = _delete_account_rows(db, user, athlete_ids)
        db.commit()
    except SQLAlchemyError as err:
        db.rollback()
        logger.exception("Account deletion failed for user %s; rolled back.", user_id)
        raise HTTPException(
            status_code=500,
            detail="No se pudo eliminar la cuenta. No se borro ningun dato; intentalo de nuevo.",
        ) from err

    # Las fotos van despues del commit: si la transaccion fallara seguirian haciendo falta.
    for food_id in deleted_food_ids:
        try:
            remove_food_photos(settings.media_root, food_id)
        except OSError as err:
            logger.warning("Could not remove photos of deleted food %s (%s).", food_id, type(err).__name__)

    return {"ok": True}
