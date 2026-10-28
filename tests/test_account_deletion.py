"""Borrado de cuenta (`DELETE /api/v1/auth/me`) contra Postgres real, con FKs aplicadas.

Los tests de auth usan un FakeDb que no conoce las FKs, por eso no veian que el
borrado reventaba (IntegrityError) en cuanto el usuario tenia dieta, progreso
compartido, proyecciones o perfil de coach. Aqui el esquema sale de
`alembic upgrade head` en una base temporal que se borra al terminar.

Postgres: `TEST_DATABASE_ADMIN_URL` (por defecto el de docker compose). Si no
responde, los tests de este modulo se saltan.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.dml import Delete

import app.api.v1.endpoints.auth as auth_endpoint
from app.auth.athlete_access import personal_athlete_id_for_user
from app.auth.security import create_access_token, hash_password
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models import (
    Athlete,
    BodyMeasurement,
    CoachAthleteAssignment,
    CoachNote,
    CoachNoteScope,
    FoodProduct,
    MealEntry,
    MealPreset,
    NutritionTarget,
    PredictionLog,
    ProgressShare,
    ProgressShareComment,
    Run,
    TrainingSession,
)
from app.db.models_auth import User, UserSettings
from app.db.models_coach import CoachBilling, CoachBillingStatus, CoachProfile
from app.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[1]
ADMIN_URL = os.getenv(
    "TEST_DATABASE_ADMIN_URL", "postgresql+psycopg://coach:coach@localhost:5432/postgres"
)
CONFIRM = {"confirm": "ELIMINAR CUENTA"}


@pytest.fixture(scope="module")
def pg_url() -> str:
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 3})
    try:
        with admin.connect():
            pass
    except OperationalError:
        admin.dispose()
        pytest.skip(f"Postgres de pruebas no disponible en {make_url(ADMIN_URL).render_as_string()}")

    name = f"coach_ai_deltest_{uuid.uuid4().hex[:8]}"
    url = make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False)
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        # Subproceso: env.py de alembic reconfigura logging y lee DATABASE_URL.
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=REPO_ROOT,
            env={**os.environ, "DATABASE_URL": url},
            check=True,
            capture_output=True,
        )
        yield url
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="module")
def pg_engine(pg_url: str):
    engine = create_engine(pg_url)
    yield engine
    engine.dispose()


@pytest.fixture
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(auth_endpoint.settings, "media_root", str(tmp_path))
    return tmp_path


@pytest.fixture
def stripe_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []

    def fake_cancel(subscription_id: str, **params):
        calls.append((subscription_id, params))
        return {"id": subscription_id, "status": "canceled"}

    monkeypatch.setattr(auth_endpoint.settings, "stripe_secret_key", "sk_test_dummy")
    monkeypatch.setattr(stripe.Subscription, "cancel", fake_cancel)
    return calls


def _client(engine, session_cls: type[Session] = Session) -> TestClient:
    factory = sessionmaker(bind=engine, autoflush=False, class_=session_cls)

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _new_user(db: Session, *, role: Role = Role.USER, plan: Plan = Plan.FREE) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("Password123"),
        role=role,
        plan=plan,
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(UserSettings(user_id=user.id, weight_unit="kg", effort_mode="rpe", modules_enabled={}))
    db.add(Athlete(athlete_id=personal_athlete_id_for_user(user)))
    db.flush()
    return user


def _food(*, owner: User | None, created_by: User, barcode: str | None) -> FoodProduct:
    return FoodProduct(
        id=uuid.uuid4(),
        owner_user_id=owner.id if owner else None,
        created_by_user_id=created_by.id,
        barcode=barcode,
        source="user_manual",
        name="Arepa de prueba",
        energy_kcal=200.0,
        status="active" if owner else "pending",
    )


def _meal(*, athlete_id: str, logged_by: User, food: FoodProduct | None = None) -> MealEntry:
    return MealEntry(
        athlete_id=athlete_id,
        logged_by_user_id=logged_by.id,
        consumed_at=datetime(2026, 10, 1, 12, 0, tzinfo=UTC),
        meal_slot="almuerzo",
        food_product_id=food.id if food else None,
        food_name="Arepa",
        quantity_g=100.0,
    )


def _training(db: Session, athlete_id: str, author: User) -> None:
    db.add(
        TrainingSession(
            athlete_id=athlete_id,
            start_time=datetime(2026, 10, 2, 8, 0, tzinfo=UTC),
            duration_min=60.0,
            exercises=[],
        )
    )
    db.add(
        Run(
            athlete_id=athlete_id,
            engine_version="test",
            config_fingerprint="fp",
            metric_key="e1rm",
            used_normalized=False,
            config={},
            summary={},
        )
    )
    db.add(PredictionLog(athlete_id=athlete_id, kind="e1rm", method="test", predicted_value=100.0))
    db.add(NutritionTarget(athlete_id=athlete_id, energy_kcal=2500.0))
    db.add(
        BodyMeasurement(
            athlete_id=athlete_id,
            measured_by_user_id=author.id,
            measured_at=datetime(2026, 10, 3, tzinfo=UTC),
            weight_kg=80.0,
        )
    )


def _write_photo(media_root: Path, product: FoodProduct) -> Path:
    folder = media_root / "food" / str(product.id)
    folder.mkdir(parents=True)
    (folder / "front.jpg").write_bytes(b"\xff\xd8\xff fake")
    product.image_front_path = f"food/{product.id}/front.jpg"
    return folder


def _seed(
    engine,
    media_root: Path,
    *,
    subscription_id: str | None = "sub_test_123",
    billing_status: str = CoachBillingStatus.ACTIVE.value,
) -> dict:
    """Coach A (el que se borra) con todo tipo de datos; B es su atleta con cuenta; C otro coach."""
    with Session(engine, expire_on_commit=False) as db:
        coach = _new_user(db, role=Role.COACH, plan=Plan.COACH)
        athlete_user = _new_user(db)
        other_coach = _new_user(db, role=Role.COACH, plan=Plan.COACH)
        coach_aid = personal_athlete_id_for_user(coach)
        athlete_aid = personal_athlete_id_for_user(athlete_user)

        # Atletas sin cuenta creados por el coach: uno solo suyo, otro compartido con C.
        managed_aid = f"coach_{uuid.uuid4().hex}"
        shared_managed_aid = f"coach_{uuid.uuid4().hex}"
        db.add_all([Athlete(athlete_id=managed_aid), Athlete(athlete_id=shared_managed_aid)])
        db.flush()
        db.add_all(
            [
                CoachAthleteAssignment(coach_user_id=coach.id, athlete_id=managed_aid),
                CoachAthleteAssignment(coach_user_id=coach.id, athlete_id=shared_managed_aid),
                CoachAthleteAssignment(coach_user_id=other_coach.id, athlete_id=shared_managed_aid),
                CoachAthleteAssignment(coach_user_id=coach.id, athlete_id=athlete_aid),
            ]
        )

        private_food = _food(owner=coach, created_by=coach, barcode=None)
        shared_food = _food(owner=None, created_by=coach, barcode=str(uuid.uuid4().int)[:13])
        private_dir = _write_photo(media_root, private_food)
        shared_dir = _write_photo(media_root, shared_food)
        db.add_all([private_food, shared_food])
        db.flush()

        _training(db, coach_aid, coach)
        _training(db, managed_aid, coach)
        _training(db, shared_managed_aid, other_coach)
        db.add_all(
            [
                _meal(athlete_id=coach_aid, logged_by=coach, food=private_food),
                _meal(athlete_id=coach_aid, logged_by=coach, food=shared_food),
                _meal(athlete_id=managed_aid, logged_by=coach),
                # El coach registra en el diario de su atleta B.
                _meal(athlete_id=athlete_aid, logged_by=coach),
                # B uso el alimento privado del coach: su comida queda, sin el vinculo.
                _meal(athlete_id=athlete_aid, logged_by=athlete_user, food=private_food),
                MealPreset(owner_user_id=coach.id, name="Desayuno", items=[]),
                CoachNote(
                    athlete_id=athlete_aid,
                    author_user_id=coach.id,
                    scope_type=CoachNoteScope.PROGRAMMING,
                    body="Sube la carga",
                ),
                BodyMeasurement(
                    athlete_id=athlete_aid,
                    measured_by_user_id=coach.id,
                    measured_at=datetime(2026, 10, 4, tzinfo=UTC),
                    weight_kg=70.0,
                ),
                CoachProfile(coach_user_id=coach.id, invite_code=uuid.uuid4().hex[:12]),
            ]
        )
        db.flush()
        # Por ORM a proposito: cubre que el Enum mande valores ("active") y no nombres ("ACTIVE").
        db.add(
            CoachBilling(
                coach_user_id=coach.id,
                stripe_customer_id="cus_test",
                stripe_subscription_id=subscription_id,
                status=CoachBillingStatus(billing_status),
            )
        )
        db.flush()

        coach_share = ProgressShare(athlete_id=coach_aid, author_user_id=coach.id, snapshot={})
        athlete_share = ProgressShare(athlete_id=athlete_aid, author_user_id=athlete_user.id, snapshot={})
        db.add_all([coach_share, athlete_share])
        db.flush()
        db.add_all(
            [
                ProgressShareComment(share_id=coach_share.id, author_user_id=coach.id, body="mio"),
                ProgressShareComment(share_id=coach_share.id, author_user_id=athlete_user.id, body="de B"),
                ProgressShareComment(share_id=athlete_share.id, author_user_id=coach.id, body="del coach"),
                ProgressShareComment(share_id=athlete_share.id, author_user_id=athlete_user.id, body="de B"),
            ]
        )
        db.commit()

        return {
            "coach": coach,
            "athlete_user": athlete_user,
            "other_coach": other_coach,
            "coach_athlete_ids": [coach_aid, managed_aid],
            "athlete_aid": athlete_aid,
            "shared_managed_aid": shared_managed_aid,
            "private_food_id": private_food.id,
            "shared_food_id": shared_food.id,
            "private_dir": private_dir,
            "shared_dir": shared_dir,
            "athlete_share_id": athlete_share.id,
        }


def _fk_columns(db: Session, referenced: str) -> list[tuple[str, str]]:
    rows = db.execute(
        text(
            """
            select c.conrelid::regclass::text, a.attname
            from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
            where c.contype = 'f' and c.confrelid = cast(:ref as regclass)
            """
        ),
        {"ref": referenced},
    ).all()
    return [(table, column) for table, column in rows]


def _leftovers(engine, user_id: uuid.UUID, athlete_ids: list[str]) -> dict[str, int]:
    """Filas que aun apuntan al usuario o a sus atletas, en CUALQUIER tabla con FK a ellos."""
    found: dict[str, int] = {}
    with Session(engine) as db:
        checks = [(t, c, user_id) for t, c in _fk_columns(db, "users")]
        checks += [(t, c, athlete_ids) for t, c in _fk_columns(db, "athletes")]
        checks += [("users", "id", user_id), ("athletes", "athlete_id", athlete_ids)]
        for table, column, value in checks:
            if isinstance(value, list):
                sql = text(f'select count(*) from "{table}" where "{column}" = any(:v)')
            else:
                sql = text(f'select count(*) from "{table}" where "{column}" = :v')
            count = db.execute(sql, {"v": value}).scalar_one()
            if count:
                found[f"{table}.{column}"] = count
    return found


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(sub=str(user.id), role=user.role, plan=user.plan)
    return {"Authorization": f"Bearer {token}"}


def test_delete_account_removes_every_row_of_the_user(pg_engine, media_root, stripe_calls) -> None:
    data = _seed(pg_engine, media_root)
    coach = data["coach"]
    assert _leftovers(pg_engine, coach.id, data["coach_athlete_ids"])  # el seed si toca todo

    response = _client(pg_engine).request("DELETE", "/api/v1/auth/me", json=CONFIRM, headers=_auth_headers(coach))

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True}
    assert _leftovers(pg_engine, coach.id, data["coach_athlete_ids"]) == {}
    assert stripe_calls == [("sub_test_123", {"api_key": "sk_test_dummy"})]

    with Session(pg_engine) as db:
        # Alimento compartido: se queda para todos, sin vinculo con la persona.
        shared = db.get(FoodProduct, data["shared_food_id"])
        assert shared is not None
        assert shared.owner_user_id is None and shared.created_by_user_id is None
        assert db.get(FoodProduct, data["private_food_id"]) is None

        # Lo de B sigue: su comida con el alimento privado del coach pierde solo el vinculo.
        b_meals = db.execute(
            select(MealEntry).where(MealEntry.athlete_id == data["athlete_aid"])
        ).scalars().all()
        assert [(m.logged_by_user_id, m.food_product_id) for m in b_meals] == [(data["athlete_user"].id, None)]
        assert db.get(User, data["athlete_user"].id) is not None
        assert db.get(Athlete, data["athlete_aid"]) is not None
        assert db.get(ProgressShare, data["athlete_share_id"]) is not None
        b_comments = db.execute(select(ProgressShareComment.author_user_id)).scalars().all()
        assert b_comments == [data["athlete_user"].id]

        # El atleta gestionado que tambien lleva otro coach no se borra.
        assert db.get(Athlete, data["shared_managed_aid"]) is not None
        assert db.execute(
            select(func.count()).select_from(TrainingSession).where(
                TrainingSession.athlete_id == data["shared_managed_aid"]
            )
        ).scalar_one() == 1
        assert db.execute(
            select(CoachAthleteAssignment.coach_user_id).where(
                CoachAthleteAssignment.athlete_id == data["shared_managed_aid"]
            )
        ).scalars().all() == [data["other_coach"].id]

    # Fotos: las del alimento privado se borran; las del catalogo compartido se quedan.
    assert not data["private_dir"].exists()
    assert (data["shared_dir"] / "front.jpg").is_file()


class _FailOnUserDelete(Session):
    def execute(self, statement, *args, **kwargs):
        if isinstance(statement, Delete) and statement.table.name == "users":
            raise SQLAlchemyError("fallo simulado")
        return super().execute(statement, *args, **kwargs)


def test_delete_account_failure_rolls_back_everything(pg_engine, media_root, stripe_calls) -> None:
    data = _seed(pg_engine, media_root)
    coach = data["coach"]
    before = _leftovers(pg_engine, coach.id, data["coach_athlete_ids"])

    response = _client(pg_engine, _FailOnUserDelete).request(
        "DELETE", "/api/v1/auth/me", json=CONFIRM, headers=_auth_headers(coach)
    )

    assert response.status_code == 500
    assert "No se borro ningun dato" in response.json()["detail"]
    assert _leftovers(pg_engine, coach.id, data["coach_athlete_ids"]) == before
    assert (data["private_dir"] / "front.jpg").is_file()
    with Session(pg_engine) as db:
        assert db.get(FoodProduct, data["shared_food_id"]).created_by_user_id == coach.id


@pytest.mark.parametrize(
    ("subscription_id", "billing_status"),
    [(None, CoachBillingStatus.NONE.value), ("sub_old", CoachBillingStatus.CANCELED.value)],
)
def test_delete_account_without_live_subscription_does_not_call_stripe(
    pg_engine, media_root, stripe_calls, subscription_id: str | None, billing_status: str
) -> None:
    data = _seed(pg_engine, media_root, subscription_id=subscription_id, billing_status=billing_status)

    response = _client(pg_engine).request(
        "DELETE", "/api/v1/auth/me", json=CONFIRM, headers=_auth_headers(data["coach"])
    )

    assert response.status_code == 200, response.text
    assert stripe_calls == []
    assert _leftovers(pg_engine, data["coach"].id, data["coach_athlete_ids"]) == {}


def test_delete_account_when_stripe_is_down_still_deletes(
    pg_engine, media_root, stripe_calls, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def offline(subscription_id: str, **params):
        raise stripe.APIConnectionError("Network error")

    monkeypatch.setattr(stripe.Subscription, "cancel", offline)
    data = _seed(pg_engine, media_root)

    with caplog.at_level(logging.WARNING, logger=auth_endpoint.logger.name):
        response = _client(pg_engine).request(
            "DELETE", "/api/v1/auth/me", json=CONFIRM, headers=_auth_headers(data["coach"])
        )

    assert response.status_code == 200, response.text
    assert _leftovers(pg_engine, data["coach"].id, data["coach_athlete_ids"]) == {}
    assert "Stripe subscription cancel failed (APIConnectionError)" in caplog.text


def test_delete_account_without_stripe_config_skips_cancel(
    pg_engine, media_root, stripe_calls, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(auth_endpoint.settings, "stripe_secret_key", None)
    data = _seed(pg_engine, media_root)

    with caplog.at_level(logging.WARNING, logger=auth_endpoint.logger.name):
        response = _client(pg_engine).request(
            "DELETE", "/api/v1/auth/me", json=CONFIRM, headers=_auth_headers(data["coach"])
        )

    assert response.status_code == 200, response.text
    assert stripe_calls == []
    assert _leftovers(pg_engine, data["coach"].id, data["coach_athlete_ids"]) == {}
    assert "STRIPE_SECRET_KEY not set" in caplog.text
