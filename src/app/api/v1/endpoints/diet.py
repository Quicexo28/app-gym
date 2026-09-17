from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from datetime import date as date_cls
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.auth.types import Role
from app.auth.view_scopes import effective_role_for_scopes, get_current_view_scopes
from app.core.config import Settings
from app.db.engine import get_db
from app.db.models import Athlete, FoodProduct, MealEntry, MealPreset, NutritionTarget
from app.db.models_auth import User
from app.nutrition import off_client
from app.nutrition.mapping import (
    map_off_nutriments_to_canonical,
    scale_micronutrients_per_100g,
    scale_per_100g,
)
from app.nutrition.media import InvalidImageError, validate_and_reencode
from app.nutrition.micronutrients import MICRONUTRIENTS
from app.nutrition.units import (
    QuantityUnitError,
    QuantityUnitKey,
    default_unit_for_basis,
    resolve_quantity_grams,
)

router = APIRouter(prefix="/diet", tags=["diet"])
DbSession = Session
settings = Settings()

MealSlot = Literal[
    # Legacy: 4 franjas fijas de antes de la personalizacion (siguen validas para
    # entries viejas y como default para atletas sin `meal_labels` configurado).
    "desayuno",
    "almuerzo",
    "cena",
    "snack",
    # Franjas genericas personalizables (doc `modulo-dieta.md`): el nombre visible
    # sale de `NutritionTarget.meal_labels`, este id solo marca el orden.
    "comida_1",
    "comida_2",
    "comida_3",
    "comida_4",
    "comida_5",
    "comida_6",
    "comida_7",
    "comida_8",
]
FoodScope = Literal["all", "mine", "global"]

MAX_MEAL_LABELS = 8

_ENTRY_TOTAL_KEYS = (
    "energy_kcal",
    "protein_g",
    "carbs_g",
    "sugars_g",
    "fiber_g",
    "fat_g",
    "sat_fat_g",
    "sodium_mg",
)
_MAX_SUMMARY_DAYS = 180


class PhotoKind(StrEnum):
    FRONT = "front"
    NUTRITION = "nutrition"


# --------------------------------------------------------------------------
# Helpers compartidos
# --------------------------------------------------------------------------


def _ensure_athlete_row(db: DbSession, athlete_id: str) -> None:
    if db.get(Athlete, athlete_id) is not None:
        return
    db.add(Athlete(athlete_id=athlete_id))


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _is_admin(user: User) -> bool:
    return effective_role_for_scopes(user, get_current_view_scopes()) == Role.ADMIN


def _day_range_utc(day: date_cls) -> tuple[datetime, datetime]:
    """Limites [inicio, fin) de un dia calendario en UTC."""
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return start, start + timedelta(days=1)


# --------------------------------------------------------------------------
# Objetivos diarios
# --------------------------------------------------------------------------


class NutritionTargetPayload(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    energy_kcal: float | None = Field(default=None, ge=0, le=10000)
    protein_g: float | None = Field(default=None, ge=0, le=1000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    fat_g: float | None = Field(default=None, ge=0, le=1000)
    fiber_g: float | None = Field(default=None, ge=0, le=300)
    micronutrient_targets: dict[str, float] | None = None
    meal_labels: list[str] | None = Field(default=None, min_length=1, max_length=MAX_MEAL_LABELS)

    @model_validator(mode="after")
    def _validate_meal_labels(self) -> NutritionTargetPayload:
        if self.meal_labels is None:
            return self
        cleaned = [label.strip() for label in self.meal_labels]
        if any(not label or len(label) > 40 for label in cleaned):
            raise ValueError("Cada nombre de comida debe tener entre 1 y 40 caracteres.")
        self.meal_labels = cleaned
        return self


class NutritionTargetResponse(BaseModel):
    athlete_id: str
    energy_kcal: float | None
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None
    fiber_g: float | None
    micronutrient_targets: dict[str, float]
    meal_labels: list[str] | None
    updated_at_utc: str | None


def _serialize_target(athlete_id: str, row: NutritionTarget | None) -> NutritionTargetResponse:
    if row is None:
        return NutritionTargetResponse(
            athlete_id=athlete_id,
            energy_kcal=None,
            protein_g=None,
            carbs_g=None,
            fat_g=None,
            fiber_g=None,
            micronutrient_targets={},
            meal_labels=None,
            updated_at_utc=None,
        )
    return NutritionTargetResponse(
        athlete_id=row.athlete_id,
        energy_kcal=row.energy_kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        fat_g=row.fat_g,
        fiber_g=row.fiber_g,
        micronutrient_targets=row.micronutrient_targets or {},
        meal_labels=row.meal_labels or None,
        updated_at_utc=row.updated_at_utc.isoformat(),
    )


@router.get("/targets", response_model=NutritionTargetResponse)
def get_nutrition_targets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    athlete_id: str = Query(min_length=1, max_length=255),
) -> NutritionTargetResponse:
    normalized = athlete_id.strip()
    require_athlete_access(db, user, normalized)
    row = db.execute(
        select(NutritionTarget).where(NutritionTarget.athlete_id == normalized)
    ).scalar_one_or_none()
    return _serialize_target(normalized, row)


@router.put("/targets", response_model=NutritionTargetResponse)
def put_nutrition_targets(
    payload: NutritionTargetPayload,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> NutritionTargetResponse:
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)
    _ensure_athlete_row(db, athlete_id)

    row = db.execute(
        select(NutritionTarget).where(NutritionTarget.athlete_id == athlete_id)
    ).scalar_one_or_none()
    if row is None:
        row = NutritionTarget(athlete_id=athlete_id)
        db.add(row)

    row.energy_kcal = payload.energy_kcal
    row.protein_g = payload.protein_g
    row.carbs_g = payload.carbs_g
    row.fat_g = payload.fat_g
    row.fiber_g = payload.fiber_g
    row.micronutrient_targets = payload.micronutrient_targets or None
    row.meal_labels = payload.meal_labels

    db.commit()
    db.refresh(row)
    return _serialize_target(athlete_id, row)


# --------------------------------------------------------------------------
# Registros de comida (entries)
# --------------------------------------------------------------------------


def _validate_quantity_pair(value: float | None, unit: str | None) -> None:
    """`quantity_value` y `quantity_unit` viajan juntos o no viajan.

    Uno solo de los dos siempre es un error del cliente: un valor sin unidad no
    se puede convertir, y una unidad sin valor no dice cuanto se comio.
    """
    if (value is None) != (unit is None):
        raise ValueError("quantity_value and quantity_unit must be sent together.")


class MealEntryCreateRequest(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    consumed_at: datetime | None = None
    meal_slot: MealSlot
    food_product_id: str | None = None
    food_name: str | None = Field(default=None, max_length=300)
    # Cantidad: o normalizada (`quantity_g`, clientes viejos y el outbox
    # encolado antes de las unidades) o tal como la escribio el usuario
    # (`quantity_value` + `quantity_unit`, que el servidor convierte). Ver
    # `_resolve_entry_quantity`.
    quantity_g: float | None = Field(default=None, gt=0, le=5000)
    quantity_value: float | None = Field(default=None, gt=0, le=100000)
    quantity_unit: QuantityUnitKey | None = None
    notes: str | None = Field(default=None, max_length=1000)
    energy_kcal: float | None = Field(default=None, ge=0, le=20000)
    protein_g: float | None = Field(default=None, ge=0, le=2000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    sugars_g: float | None = Field(default=None, ge=0, le=2000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    fat_g: float | None = Field(default=None, ge=0, le=2000)
    sat_fat_g: float | None = Field(default=None, ge=0, le=2000)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    micronutrients: dict[str, float] | None = None
    client_ref: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _validate_source(self) -> MealEntryCreateRequest:
        if not self.food_product_id and not (self.food_name and self.food_name.strip()):
            raise ValueError("food_product_id or food_name is required.")
        _validate_quantity_pair(self.quantity_value, self.quantity_unit)
        if self.quantity_g is None and self.quantity_value is None:
            raise ValueError("quantity_g or quantity_value + quantity_unit is required.")
        return self


class MealEntryUpdateRequest(BaseModel):
    consumed_at: datetime | None = None
    meal_slot: MealSlot | None = None
    quantity_g: float | None = Field(default=None, gt=0, le=5000)
    quantity_value: float | None = Field(default=None, gt=0, le=100000)
    quantity_unit: QuantityUnitKey | None = None
    food_name: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=1000)
    energy_kcal: float | None = Field(default=None, ge=0, le=20000)
    protein_g: float | None = Field(default=None, ge=0, le=2000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    sugars_g: float | None = Field(default=None, ge=0, le=2000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    fat_g: float | None = Field(default=None, ge=0, le=2000)
    sat_fat_g: float | None = Field(default=None, ge=0, le=2000)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    micronutrients: dict[str, float] | None = None

    @model_validator(mode="after")
    def _validate_quantity(self) -> MealEntryUpdateRequest:
        _validate_quantity_pair(self.quantity_value, self.quantity_unit)
        return self


class MealEntryFromPresetRequest(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    preset_id: str
    consumed_at: datetime | None = None
    meal_slot: MealSlot | None = None
    # Ref de LOTE (uno por intento de guardado), no uno por item del preset;
    # ver docstring de `create_entries_from_preset`.
    client_ref: str | None = Field(default=None, max_length=48)


class MealEntryItem(BaseModel):
    id: str
    athlete_id: str
    logged_by_user_id: str
    consumed_at: str
    meal_slot: str
    food_product_id: str | None
    food_name: str
    quantity_g: float
    #: Lo que escribio el usuario. `None` en entradas anteriores a las unidades.
    quantity_value: float | None
    quantity_unit: str | None
    energy_kcal: float | None
    protein_g: float | None
    carbs_g: float | None
    sugars_g: float | None
    fiber_g: float | None
    fat_g: float | None
    sat_fat_g: float | None
    sodium_mg: float | None
    micronutrients: dict[str, float]
    notes: str | None
    created_at_utc: str


class DailyTotalsResponse(BaseModel):
    energy_kcal: float
    protein_g: float
    carbs_g: float
    sugars_g: float
    fiber_g: float
    fat_g: float
    sat_fat_g: float
    sodium_mg: float
    micronutrients: dict[str, float]


class MealEntriesResponse(BaseModel):
    athlete_id: str
    date: str
    items: list[MealEntryItem]
    totals: DailyTotalsResponse


class DietSummaryDayItem(BaseModel):
    date: str
    totals: DailyTotalsResponse


class DietSummaryResponse(BaseModel):
    athlete_id: str
    from_date: str
    to_date: str
    days: list[DietSummaryDayItem]


@dataclass(slots=True)
class DailyTotals:
    energy_kcal: float
    protein_g: float
    carbs_g: float
    sugars_g: float
    fiber_g: float
    fat_g: float
    sat_fat_g: float
    sodium_mg: float
    micronutrients: dict[str, float]


def _aggregate_daily_totals(entries: Iterable[MealEntry]) -> DailyTotals:
    """Suma los macros y micronutrientes de un conjunto de registros de comida.

    Los valores None de cada registro se tratan como cero (no se descarta el
    registro completo por faltarle un campo).
    """
    totals = dict.fromkeys(_ENTRY_TOTAL_KEYS, 0.0)
    micro_totals: dict[str, float] = {}

    for entry in entries:
        for key in _ENTRY_TOTAL_KEYS:
            value = getattr(entry, key)
            if value is not None:
                totals[key] += value
        for micro_key, micro_value in (entry.micronutrients or {}).items():
            if micro_value is None:
                continue
            micro_totals[micro_key] = micro_totals.get(micro_key, 0.0) + micro_value

    rounded_totals = {key: round(value, 2) for key, value in totals.items()}
    rounded_micro = {key: round(value, 4) for key, value in micro_totals.items()}
    return DailyTotals(micronutrients=rounded_micro, **rounded_totals)


def _totals_to_response(totals: DailyTotals) -> DailyTotalsResponse:
    return DailyTotalsResponse(
        energy_kcal=totals.energy_kcal,
        protein_g=totals.protein_g,
        carbs_g=totals.carbs_g,
        sugars_g=totals.sugars_g,
        fiber_g=totals.fiber_g,
        fat_g=totals.fat_g,
        sat_fat_g=totals.sat_fat_g,
        sodium_mg=totals.sodium_mg,
        micronutrients=totals.micronutrients,
    )


def _serialize_entry(row: MealEntry) -> MealEntryItem:
    return MealEntryItem(
        id=str(row.id),
        athlete_id=row.athlete_id,
        logged_by_user_id=str(row.logged_by_user_id),
        consumed_at=row.consumed_at.isoformat(),
        meal_slot=row.meal_slot,
        food_product_id=str(row.food_product_id) if row.food_product_id else None,
        food_name=row.food_name,
        quantity_g=row.quantity_g,
        quantity_value=row.quantity_value,
        quantity_unit=row.quantity_unit,
        energy_kcal=row.energy_kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        sugars_g=row.sugars_g,
        fiber_g=row.fiber_g,
        fat_g=row.fat_g,
        sat_fat_g=row.sat_fat_g,
        sodium_mg=row.sodium_mg,
        micronutrients=row.micronutrients or {},
        notes=row.notes,
        created_at_utc=row.created_at_utc.isoformat(),
    )


def _snapshot_from_food_product(product: FoodProduct, quantity_g: float) -> dict[str, Any]:
    """Escala los macros/micros per-100g del catalogo a la cantidad consumida."""
    return {
        "food_name": product.name,
        "energy_kcal": scale_per_100g(product.energy_kcal, quantity_g),
        "protein_g": scale_per_100g(product.protein_g, quantity_g),
        "carbs_g": scale_per_100g(product.carbs_g, quantity_g),
        "sugars_g": scale_per_100g(product.sugars_g, quantity_g),
        "fiber_g": scale_per_100g(product.fiber_g, quantity_g),
        "fat_g": scale_per_100g(product.fat_g, quantity_g),
        "sat_fat_g": scale_per_100g(product.sat_fat_g, quantity_g),
        "sodium_mg": scale_per_100g(product.sodium_mg, quantity_g),
        "micronutrients": scale_micronutrients_per_100g(product.micronutrients, quantity_g),
    }


def _resolve_entry_quantity(
    *,
    quantity_g: float | None,
    quantity_value: float | None,
    quantity_unit: str | None,
    product: FoodProduct | None,
) -> tuple[float, float, str]:
    """Devuelve `(quantity_g normalizada, quantity_value, quantity_unit)` a guardar.

    La conversion la hace SIEMPRE el servidor: es el unico que conoce el
    `serving_size_g` del catalogo (necesario para `porcion`) y asi un cliente
    desactualizado no puede escribir un `quantity_g` que no cuadre con la
    unidad. Sin unidad se asume la base del alimento (g, o ml si es liquido),
    que es lo que venian mandando los clientes previos a este cambio.
    """
    if quantity_value is not None and quantity_unit is not None:
        try:
            grams = resolve_quantity_grams(
                quantity_value, quantity_unit, product.serving_size_g if product else None
            )
        except QuantityUnitError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        return grams, quantity_value, quantity_unit

    if quantity_g is None:
        raise HTTPException(
            status_code=422, detail="quantity_g or quantity_value + quantity_unit is required."
        )
    return quantity_g, quantity_g, default_unit_for_basis(product.basis if product else None)


def _get_entry_or_404(db: DbSession, entry_id: uuid.UUID) -> MealEntry:
    row = db.get(MealEntry, entry_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Meal entry not found.")
    return row


def _find_meal_entry_by_client_ref(
    db: DbSession, athlete_id: str, client_ref: str
) -> MealEntry | None:
    return db.execute(
        select(MealEntry).where(
            MealEntry.athlete_id == athlete_id, MealEntry.client_ref == client_ref
        )
    ).scalar_one_or_none()


def _escape_like(value: str) -> str:
    """Neutraliza los comodines de LIKE (`%`, `_`) y el propio escape.

    `batch_ref` llega del cliente, asi que sin escapar el patron es suyo, no
    nuestro: un `client_ref` de "%" produce "%:%" y matchea TODAS las entradas
    por lote del atleta, con lo que un reintento devolveria las equivocadas en
    vez de crear las pedidas. Ademas `uid()` del frontend genera refs con "_",
    que en LIKE es comodin de un caracter.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _find_meal_entries_by_batch_ref(
    db: DbSession, athlete_id: str, batch_ref: str
) -> list[MealEntry]:
    return (
        db.execute(
            select(MealEntry)
            .where(
                MealEntry.athlete_id == athlete_id,
                MealEntry.client_ref.like(f"{_escape_like(batch_ref)}:%", escape="\\"),
            )
            .order_by(MealEntry.created_at_utc.asc())
        )
        .scalars()
        .all()
    )


@router.get("/entries", response_model=MealEntriesResponse)
def list_meal_entries(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    date: Annotated[date_cls, Query()],
    athlete_id: str = Query(min_length=1, max_length=255),
) -> MealEntriesResponse:
    normalized = athlete_id.strip()
    require_athlete_access(db, user, normalized)

    start_utc, end_utc = _day_range_utc(date)
    rows = (
        db.execute(
            select(MealEntry)
            .where(
                MealEntry.athlete_id == normalized,
                MealEntry.consumed_at >= start_utc,
                MealEntry.consumed_at < end_utc,
            )
            .order_by(MealEntry.consumed_at.asc())
        )
        .scalars()
        .all()
    )
    totals = _aggregate_daily_totals(rows)
    return MealEntriesResponse(
        athlete_id=normalized,
        date=date.isoformat(),
        items=[_serialize_entry(row) for row in rows],
        totals=_totals_to_response(totals),
    )


@router.post("/entries", response_model=MealEntryItem, status_code=status.HTTP_201_CREATED)
def create_meal_entry(
    payload: MealEntryCreateRequest,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> MealEntryItem:
    """Crea un registro de comida.

    Idempotencia (doc `modulo-dieta.md` #7 criterio 6): si `payload.client_ref`
    viene informado y ya existe una entrada de este atleta con ese ref, se
    devuelve esa entrada tal cual con 200 en vez de crear un duplicado. El
    outbox offline del frontend genera el `client_ref` al encolar (no al
    reintentar), asi que un timeout que ocurrio despues del commit del
    servidor no duplica la comida al reintentar. Sin `client_ref` el
    comportamiento es el de siempre: cada POST crea una entrada nueva.
    """
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)
    _ensure_athlete_row(db, athlete_id)

    client_ref = (payload.client_ref or "").strip() or None
    if client_ref:
        existing = _find_meal_entry_by_client_ref(db, athlete_id, client_ref)
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return _serialize_entry(existing)

    consumed_at = _to_utc(payload.consumed_at or datetime.now(UTC))

    food_product_id: uuid.UUID | None = None
    product: FoodProduct | None = None
    snapshot: dict[str, Any]

    if payload.food_product_id:
        try:
            food_product_id = uuid.UUID(payload.food_product_id)
        except ValueError as err:
            raise HTTPException(status_code=400, detail="Invalid food_product_id.") from err
        product = db.get(FoodProduct, food_product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Food product not found.")

    quantity_g, quantity_value, quantity_unit = _resolve_entry_quantity(
        quantity_g=payload.quantity_g,
        quantity_value=payload.quantity_value,
        quantity_unit=payload.quantity_unit,
        product=product,
    )

    if product is not None:
        snapshot = _snapshot_from_food_product(product, quantity_g)
        if payload.food_name and payload.food_name.strip():
            snapshot["food_name"] = payload.food_name.strip()
    else:
        snapshot = {
            "food_name": (payload.food_name or "").strip(),
            "energy_kcal": payload.energy_kcal,
            "protein_g": payload.protein_g,
            "carbs_g": payload.carbs_g,
            "sugars_g": payload.sugars_g,
            "fiber_g": payload.fiber_g,
            "fat_g": payload.fat_g,
            "sat_fat_g": payload.sat_fat_g,
            "sodium_mg": payload.sodium_mg,
            "micronutrients": payload.micronutrients or {},
        }

    # Cualquier valor explicito del payload gana sobre lo calculado del catalogo:
    # el OCR/catalogo propone, el usuario siempre puede corregir.
    for key in _ENTRY_TOTAL_KEYS:
        override = getattr(payload, key)
        if override is not None:
            snapshot[key] = override
    if payload.micronutrients:
        snapshot["micronutrients"] = payload.micronutrients

    row = MealEntry(
        athlete_id=athlete_id,
        logged_by_user_id=user.id,
        consumed_at=consumed_at,
        meal_slot=payload.meal_slot,
        food_product_id=food_product_id,
        food_name=snapshot["food_name"],
        quantity_g=quantity_g,
        quantity_value=quantity_value,
        quantity_unit=quantity_unit,
        energy_kcal=snapshot["energy_kcal"],
        protein_g=snapshot["protein_g"],
        carbs_g=snapshot["carbs_g"],
        sugars_g=snapshot["sugars_g"],
        fiber_g=snapshot["fiber_g"],
        fat_g=snapshot["fat_g"],
        sat_fat_g=snapshot["sat_fat_g"],
        sodium_mg=snapshot["sodium_mg"],
        micronutrients=snapshot["micronutrients"] or None,
        notes=payload.notes,
        client_ref=client_ref,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        # Carrera: otro request con el mismo client_ref ya comiteo entre el
        # chequeo de arriba y este commit. El indice unico parcial es la
        # garantia real; esto solo evita que la carrera se vea como error 500.
        if client_ref:
            existing = _find_meal_entry_by_client_ref(db, athlete_id, client_ref)
            if existing is not None:
                response.status_code = status.HTTP_200_OK
                return _serialize_entry(existing)
        raise HTTPException(status_code=409, detail="Duplicate meal entry.") from err
    db.refresh(row)
    return _serialize_entry(row)


@router.patch("/entries/{entry_id}", response_model=MealEntryItem)
def update_meal_entry(
    entry_id: uuid.UUID,
    payload: MealEntryUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> MealEntryItem:
    row = _get_entry_or_404(db, entry_id)
    require_athlete_access(db, user, row.athlete_id)

    sent = payload.model_fields_set

    quantity_sent = {"quantity_g", "quantity_value", "quantity_unit"} & sent
    if quantity_sent and (payload.quantity_g is not None or payload.quantity_value is not None):
        product = (
            db.get(FoodProduct, row.food_product_id) if row.food_product_id is not None else None
        )
        row.quantity_g, row.quantity_value, row.quantity_unit = _resolve_entry_quantity(
            quantity_g=payload.quantity_g,
            quantity_value=payload.quantity_value,
            quantity_unit=payload.quantity_unit,
            product=product,
        )
        if product is not None:
            snapshot = _snapshot_from_food_product(product, row.quantity_g)
            for key in _ENTRY_TOTAL_KEYS:
                setattr(row, key, snapshot[key])
            row.micronutrients = snapshot["micronutrients"] or None

    if "consumed_at" in sent and payload.consumed_at is not None:
        row.consumed_at = _to_utc(payload.consumed_at)
    if "meal_slot" in sent and payload.meal_slot is not None:
        row.meal_slot = payload.meal_slot
    if "food_name" in sent and payload.food_name is not None:
        cleaned = payload.food_name.strip()
        if cleaned:
            row.food_name = cleaned
    if "notes" in sent:
        row.notes = payload.notes

    for key in _ENTRY_TOTAL_KEYS:
        if key in sent:
            override = getattr(payload, key)
            if override is not None:
                setattr(row, key, override)
    if "micronutrients" in sent and payload.micronutrients is not None:
        row.micronutrients = payload.micronutrients or None

    db.commit()
    db.refresh(row)
    return _serialize_entry(row)


@router.delete("/entries/{entry_id}")
def delete_meal_entry(
    entry_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    row = _get_entry_or_404(db, entry_id)
    require_athlete_access(db, user, row.athlete_id)
    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(entry_id)}


@router.post(
    "/entries/from-preset", response_model=list[MealEntryItem], status_code=status.HTTP_201_CREATED
)
def create_entries_from_preset(
    payload: MealEntryFromPresetRequest,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> list[MealEntryItem]:
    """Crea N registros de comida a partir de un preset (uno por item).

    Idempotencia: a diferencia de `create_meal_entry`, aqui `client_ref` es
    un ref de LOTE (uno por intento de guardado del outbox), no uno por item.
    Se eligio asi porque un preset tiene un numero variable de items y el
    cliente offline solo conoce un client_ref por envio -- pedirle N refs
    (uno por item) complicaria el outbox sin necesidad. Cada entrada creada
    guarda un client_ref derivado `f"{batch_ref}:{indice_del_item}"`, unico
    por atleta gracias al mismo indice parcial de `meal_entries` que usa el
    endpoint singular. Un reintento con el mismo `client_ref` de lote busca
    las entradas ya creadas con ese prefijo y las devuelve tal cual con 200,
    sin duplicar -- siempre que el preset no haya cambiado de items entre el
    intento original y el reintento (asuncion razonable para un reintento
    offline en la misma sesion). Sin `client_ref` el comportamiento es el de
    siempre.
    """
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)
    _ensure_athlete_row(db, athlete_id)

    try:
        preset_id = uuid.UUID(payload.preset_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail="Invalid preset_id.") from err

    preset = db.execute(
        select(MealPreset).where(MealPreset.id == preset_id, MealPreset.owner_user_id == user.id)
    ).scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found.")

    items = preset.items or []
    if not items:
        raise HTTPException(status_code=400, detail="Preset has no items.")

    batch_ref = (payload.client_ref or "").strip() or None
    if batch_ref:
        existing = _find_meal_entries_by_batch_ref(db, athlete_id, batch_ref)
        if existing:
            response.status_code = status.HTTP_200_OK
            return [_serialize_entry(row) for row in existing]

    consumed_at = _to_utc(payload.consumed_at or datetime.now(UTC))
    meal_slot = payload.meal_slot or preset.meal_slot or "snack"

    created: list[MealEntry] = []
    for index, item in enumerate(items):
        quantity_g = float(item.get("quantity_g") or 0)
        if quantity_g <= 0:
            continue

        food_product_id: uuid.UUID | None = None
        raw_food_product_id = item.get("food_product_id")
        if raw_food_product_id:
            try:
                food_product_id = uuid.UUID(str(raw_food_product_id))
            except ValueError:
                food_product_id = None

        row = MealEntry(
            athlete_id=athlete_id,
            logged_by_user_id=user.id,
            consumed_at=consumed_at,
            meal_slot=meal_slot,
            food_product_id=food_product_id,
            food_name=str(item.get("food_name") or "Alimento"),
            quantity_g=quantity_g,
            quantity_value=item.get("quantity_value"),
            quantity_unit=item.get("quantity_unit"),
            energy_kcal=item.get("energy_kcal"),
            protein_g=item.get("protein_g"),
            carbs_g=item.get("carbs_g"),
            sugars_g=item.get("sugars_g"),
            fiber_g=item.get("fiber_g"),
            fat_g=item.get("fat_g"),
            sat_fat_g=item.get("sat_fat_g"),
            sodium_mg=item.get("sodium_mg"),
            micronutrients=item.get("micronutrients") or None,
            client_ref=f"{batch_ref}:{index}" if batch_ref else None,
        )
        db.add(row)
        created.append(row)

    if not created:
        raise HTTPException(status_code=400, detail="Preset has no valid items.")

    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        # Carrera equivalente a la de create_meal_entry, a nivel de lote.
        if batch_ref:
            existing = _find_meal_entries_by_batch_ref(db, athlete_id, batch_ref)
            if existing:
                response.status_code = status.HTTP_200_OK
                return [_serialize_entry(row) for row in existing]
        raise HTTPException(status_code=409, detail="Duplicate preset submission.") from err
    for row in created:
        db.refresh(row)
    return [_serialize_entry(row) for row in created]


@router.get("/summary", response_model=DietSummaryResponse)
def get_diet_summary(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    from_: Annotated[date_cls, Query(alias="from")],
    to: Annotated[date_cls, Query(alias="to")],
    athlete_id: str = Query(min_length=1, max_length=255),
) -> DietSummaryResponse:
    normalized = athlete_id.strip()
    require_athlete_access(db, user, normalized)

    if to < from_:
        raise HTTPException(status_code=400, detail="'to' must not be before 'from'.")
    span_days = (to - from_).days + 1
    if span_days > _MAX_SUMMARY_DAYS:
        raise HTTPException(
            status_code=400, detail=f"Range too large (max {_MAX_SUMMARY_DAYS} days)."
        )

    start_utc, _unused_end = _day_range_utc(from_)
    _unused_start, end_utc = _day_range_utc(to)

    rows = (
        db.execute(
            select(MealEntry)
            .where(
                MealEntry.athlete_id == normalized,
                MealEntry.consumed_at >= start_utc,
                MealEntry.consumed_at < end_utc,
            )
            .order_by(MealEntry.consumed_at.asc())
        )
        .scalars()
        .all()
    )

    by_day: dict[date_cls, list[MealEntry]] = {}
    for row in rows:
        day = row.consumed_at.astimezone(UTC).date()
        by_day.setdefault(day, []).append(row)

    days: list[DietSummaryDayItem] = []
    cursor = from_
    while cursor <= to:
        entries = by_day.get(cursor, [])
        days.append(
            DietSummaryDayItem(
                date=cursor.isoformat(),
                totals=_totals_to_response(_aggregate_daily_totals(entries)),
            )
        )
        cursor += timedelta(days=1)

    return DietSummaryResponse(
        athlete_id=normalized,
        from_date=from_.isoformat(),
        to_date=to.isoformat(),
        days=days,
    )


# --------------------------------------------------------------------------
# Catalogo de alimentos
# --------------------------------------------------------------------------


class FoodProductCreateRequest(BaseModel):
    barcode: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=300)
    brand: str | None = Field(default=None, max_length=200)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    serving_size_g: float | None = Field(default=None, gt=0, le=5000)
    serving_label: str | None = Field(default=None, max_length=120)
    package_qty_g: float | None = Field(default=None, gt=0, le=50000)
    basis: Literal["per_100g", "per_100ml"] = "per_100g"
    energy_kcal: float | None = Field(default=None, ge=0, le=900)
    protein_g: float | None = Field(default=None, ge=0, le=100)
    carbs_g: float | None = Field(default=None, ge=0, le=100)
    sugars_g: float | None = Field(default=None, ge=0, le=100)
    fiber_g: float | None = Field(default=None, ge=0, le=100)
    fat_g: float | None = Field(default=None, ge=0, le=100)
    sat_fat_g: float | None = Field(default=None, ge=0, le=100)
    trans_fat_g: float | None = Field(default=None, ge=0, le=100)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    cholesterol_mg: float | None = Field(default=None, ge=0, le=10000)
    micronutrients: dict[str, float] | None = None


class FoodProductUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    brand: str | None = Field(default=None, max_length=200)
    country_code: str | None = Field(default=None, max_length=2)
    serving_size_g: float | None = Field(default=None, gt=0, le=5000)
    serving_label: str | None = Field(default=None, max_length=120)
    package_qty_g: float | None = Field(default=None, gt=0, le=50000)
    basis: Literal["per_100g", "per_100ml"] | None = None
    energy_kcal: float | None = Field(default=None, ge=0, le=900)
    protein_g: float | None = Field(default=None, ge=0, le=100)
    carbs_g: float | None = Field(default=None, ge=0, le=100)
    sugars_g: float | None = Field(default=None, ge=0, le=100)
    fiber_g: float | None = Field(default=None, ge=0, le=100)
    fat_g: float | None = Field(default=None, ge=0, le=100)
    sat_fat_g: float | None = Field(default=None, ge=0, le=100)
    trans_fat_g: float | None = Field(default=None, ge=0, le=100)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    cholesterol_mg: float | None = Field(default=None, ge=0, le=10000)
    micronutrients: dict[str, float] | None = None
    status: Literal["active", "pending", "rejected"] | None = None


class FoodProductItem(BaseModel):
    id: str
    owner_user_id: str | None
    barcode: str | None
    source: str
    source_ref: str | None
    name: str
    brand: str | None
    country_code: str | None
    category: str | None
    serving_size_g: float | None
    serving_label: str | None
    package_qty_g: float | None
    basis: str
    energy_kcal: float | None
    protein_g: float | None
    carbs_g: float | None
    sugars_g: float | None
    fiber_g: float | None
    fat_g: float | None
    sat_fat_g: float | None
    trans_fat_g: float | None
    sodium_mg: float | None
    cholesterol_mg: float | None
    micronutrients: dict[str, float]
    image_front_path: str | None
    image_nutrition_path: str | None
    verified_count: int
    status: str
    created_at_utc: str


def _serialize_food(row: FoodProduct) -> FoodProductItem:
    return FoodProductItem(
        id=str(row.id),
        owner_user_id=str(row.owner_user_id) if row.owner_user_id else None,
        barcode=row.barcode,
        source=row.source,
        source_ref=row.source_ref,
        name=row.name,
        brand=row.brand,
        country_code=row.country_code,
        category=row.category,
        serving_size_g=row.serving_size_g,
        serving_label=row.serving_label,
        package_qty_g=row.package_qty_g,
        basis=row.basis,
        energy_kcal=row.energy_kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        sugars_g=row.sugars_g,
        fiber_g=row.fiber_g,
        fat_g=row.fat_g,
        sat_fat_g=row.sat_fat_g,
        trans_fat_g=row.trans_fat_g,
        sodium_mg=row.sodium_mg,
        cholesterol_mg=row.cholesterol_mg,
        micronutrients=row.micronutrients or {},
        image_front_path=row.image_front_path,
        image_nutrition_path=row.image_nutrition_path,
        verified_count=row.verified_count,
        status=row.status,
        created_at_utc=row.created_at_utc.isoformat(),
    )


def _looks_like_liquid(quantity_label: str | None) -> bool:
    if not quantity_label:
        return False
    return "ml" in quantity_label.strip().lower()


def _authorize_food_write(row: FoodProduct, user: User) -> bool:
    """Autorizacion de escritura sobre un FoodProduct.

    Un alimento personal (owner_user_id != NULL) solo lo edita su dueno. Un
    alimento global (owner_user_id NULL) solo lo edita un admin. Devuelve
    True cuando quien escribe es un admin sobre un producto global (para
    poder tocar `status`/`verified_count`); False cuando es el dueno de un
    producto personal.
    """
    if row.owner_user_id is not None:
        if row.owner_user_id == user.id:
            return False
        raise HTTPException(status_code=403, detail="No autorizado para modificar este alimento.")
    if _is_admin(user):
        return True
    raise HTTPException(
        status_code=403, detail="Los productos globales solo los edita un administrador."
    )


@router.get("/foods/categories", response_model=list[str])
def list_food_categories(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    scope: FoodScope = "all",
) -> list[str]:
    if scope == "mine":
        scope_filter = FoodProduct.owner_user_id == user.id
    elif scope == "global":
        scope_filter = FoodProduct.owner_user_id.is_(None)
    else:
        scope_filter = or_(
            FoodProduct.owner_user_id.is_(None), FoodProduct.owner_user_id == user.id
        )

    rows = (
        db.execute(
            select(FoodProduct.category)
            .where(scope_filter, FoodProduct.category.is_not(None))
            .distinct()
            .order_by(FoodProduct.category.asc())
        )
        .scalars()
        .all()
    )
    return list(rows)


@router.get("/foods/recent", response_model=list[FoodProductItem])
def list_recent_foods(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    athlete_id: str = Query(min_length=1, max_length=255),
    limit: int = Query(default=12, ge=1, le=50),
) -> list[FoodProductItem]:
    """Alimentos del catalogo que este atleta registro mas recientemente.

    Alimenta la fila "Recientes" del buscador: la comida se repite casi todos
    los dias, asi que lo ultimo usado ahorra volver a escribir el nombre. Solo
    salen entradas ligadas al catalogo (`food_product_id`); las manuales no
    tienen producto que volver a elegir. Se filtra por visibilidad igual que la
    busqueda para no exponer productos privados de otro usuario.
    """
    normalized = athlete_id.strip()
    require_athlete_access(db, user, normalized)

    last_used = (
        select(
            MealEntry.food_product_id.label("food_id"),
            func.max(MealEntry.consumed_at).label("last_at"),
        )
        .where(MealEntry.athlete_id == normalized, MealEntry.food_product_id.is_not(None))
        .group_by(MealEntry.food_product_id)
        .subquery()
    )
    rows = (
        db.execute(
            select(FoodProduct)
            .join(last_used, last_used.c.food_id == FoodProduct.id)
            .where(
                or_(
                    FoodProduct.owner_user_id.is_(None),
                    FoodProduct.owner_user_id == user.id,
                )
            )
            .order_by(last_used.c.last_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [_serialize_food(row) for row in rows]


_SEARCH_TOKEN_SPLIT = re.compile(r"[^0-9a-z]+")
_MAX_SEARCH_TOKENS = 6
_MAX_SEARCH_CATEGORIES = 12


def _strip_accents(value: str) -> str:
    """Minusculas sin tildes, igual que `immutable_unaccent(lower(name))` en SQL."""
    decomposed = unicodedata.normalize("NFD", value.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _singularize(token: str) -> str:
    """Plural espanol -> raiz buscable ("huevos" -> "huevo", "carnes" -> "carn").

    Corta en vez de conjugar bien a proposito: la raiz se busca como subcadena,
    asi que basta con que sea prefijo del singular del catalogo.
    """
    if len(token) > 4 and token.endswith("es"):
        return token[:-2]
    if len(token) > 3 and token.endswith("s"):
        return token[:-1]
    return token


def _food_search_tokens(term: str) -> list[str]:
    """Termino libre -> tokens normalizados que se exigen todos por separado.

    "Huevos fritos" -> ["huevo", "frito"]. El catalogo TCAC nombra en singular y
    con otro orden de palabras ("Huevo de gallina, entero, frito"), asi que
    comparar el termino entero contra el nombre entero no encontraba nada.
    """
    normalized = _strip_accents(term)
    tokens = [_singularize(part) for part in _SEARCH_TOKEN_SPLIT.split(normalized) if len(part) > 1]
    return tokens[:_MAX_SEARCH_TOKENS]


@router.get("/foods/search", response_model=list[FoodProductItem])
def search_foods(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    q: str = Query(default="", max_length=200),
    scope: FoodScope = "all",
    category: Annotated[list[str] | None, Query()] = None,
    min_kcal: float | None = Query(default=None, ge=0),
    max_kcal: float | None = Query(default=None, ge=0),
    min_protein: float | None = Query(default=None, ge=0),
    max_protein: float | None = Query(default=None, ge=0),
    min_carbs: float | None = Query(default=None, ge=0),
    max_carbs: float | None = Query(default=None, ge=0),
    min_fat: float | None = Query(default=None, ge=0),
    max_fat: float | None = Query(default=None, ge=0),
    limit: int = Query(default=20, ge=1, le=200),
) -> list[FoodProductItem]:
    if scope == "mine":
        scope_filter = FoodProduct.owner_user_id == user.id
    elif scope == "global":
        scope_filter = FoodProduct.owner_user_id.is_(None)
    else:
        scope_filter = or_(
            FoodProduct.owner_user_id.is_(None), FoodProduct.owner_user_id == user.id
        )

    # `q` vacio = listar el catalogo del scope (para poder explorarlo sin
    # tener que adivinar un nombre) en vez de exigir siempre un termino.
    filters = [scope_filter]
    tokens = _food_search_tokens(q)
    name_norm = func.immutable_unaccent(func.lower(FoodProduct.name))
    for token in tokens:
        filters.append(name_norm.like(f"%{token}%"))
    # `category` admite valores repetidos (`?category=A&category=B`) porque los
    # grupos que muestra el buscador ("Proteina", "Carbohidratos") agrupan varias
    # categorias del catalogo TCAC en una sola pestana.
    categories = [value.strip()[:80] for value in (category or []) if value.strip()]
    if categories:
        filters.append(FoodProduct.category.in_(categories[:_MAX_SEARCH_CATEGORIES]))
    if min_kcal is not None:
        filters.append(FoodProduct.energy_kcal >= min_kcal)
    if max_kcal is not None:
        filters.append(FoodProduct.energy_kcal <= max_kcal)
    if min_protein is not None:
        filters.append(FoodProduct.protein_g >= min_protein)
    if max_protein is not None:
        filters.append(FoodProduct.protein_g <= max_protein)
    if min_carbs is not None:
        filters.append(FoodProduct.carbs_g >= min_carbs)
    if max_carbs is not None:
        filters.append(FoodProduct.carbs_g <= max_carbs)
    if min_fat is not None:
        filters.append(FoodProduct.fat_g >= min_fat)
    if max_fat is not None:
        filters.append(FoodProduct.fat_g <= max_fat)

    if tokens:
        # Relevancia: primero el nombre que ES el termino ("huevo" -> "Huevo"),
        # luego los que empiezan por el; a igual rango gana el nombre mas corto,
        # que en TCAC es el menos especificado ("Huevo de gallina, entero, crudo"
        # antes que "..., frito, con sal").
        relevance = case(
            (name_norm == " ".join(tokens), 0),
            (name_norm.like(f"{tokens[0]}%"), 1),
            else_=2,
        )
        order_by = [relevance, func.length(FoodProduct.name), FoodProduct.name.asc()]
    else:
        order_by = [FoodProduct.name.asc()]

    rows = (
        db.execute(select(FoodProduct).where(*filters).order_by(*order_by).limit(limit))
        .scalars()
        .all()
    )
    return [_serialize_food(row) for row in rows]


@router.get("/foods/barcode/{barcode}", response_model=FoodProductItem)
def get_food_by_barcode(
    barcode: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> FoodProductItem:
    clean_barcode = barcode.strip()
    if not clean_barcode:
        raise HTTPException(status_code=400, detail="barcode is required.")

    own = (
        db.execute(
            select(FoodProduct).where(
                FoodProduct.owner_user_id == user.id, FoodProduct.barcode == clean_barcode
            )
        )
        .scalars()
        .first()
    )
    if own is not None:
        return _serialize_food(own)

    glob = (
        db.execute(
            select(FoodProduct).where(
                FoodProduct.owner_user_id.is_(None), FoodProduct.barcode == clean_barcode
            )
        )
        .scalars()
        .first()
    )
    if glob is not None:
        return _serialize_food(glob)

    off_product = off_client.fetch_product_by_barcode(clean_barcode)
    if off_product is None:
        raise HTTPException(status_code=404, detail="Product not found.")

    macros, micronutrients = map_off_nutriments_to_canonical(off_product.nutriments)
    row = FoodProduct(
        owner_user_id=None,
        barcode=off_product.barcode,
        source="off",
        source_ref=off_product.barcode,
        name=off_product.name,
        brand=off_product.brand,
        country_code=None,
        serving_label=off_product.quantity_label,
        basis="per_100ml" if _looks_like_liquid(off_product.quantity_label) else "per_100g",
        energy_kcal=macros.get("energy_kcal"),
        protein_g=macros.get("protein_g"),
        carbs_g=macros.get("carbs_g"),
        sugars_g=macros.get("sugars_g"),
        fiber_g=macros.get("fiber_g"),
        fat_g=macros.get("fat_g"),
        sat_fat_g=macros.get("sat_fat_g"),
        trans_fat_g=macros.get("trans_fat_g"),
        sodium_mg=macros.get("sodium_mg"),
        cholesterol_mg=macros.get("cholesterol_mg"),
        micronutrients=micronutrients or None,
        status="active",
        verified_count=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_food(row)


@router.post("/foods", response_model=FoodProductItem, status_code=status.HTTP_201_CREATED)
def create_food_product(
    payload: FoodProductCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> FoodProductItem:
    barcode = (payload.barcode or "").strip() or None

    # Un producto con barcode se aporta al catalogo compartido (status
    # 'pending', visible para todos); sin barcode queda como alimento
    # personal del usuario que lo crea.
    owner_user_id = None if barcode else user.id
    status_value = "pending" if barcode else "active"

    row = FoodProduct(
        owner_user_id=owner_user_id,
        barcode=barcode,
        source="user_manual",
        name=payload.name.strip(),
        brand=(payload.brand or "").strip() or None,
        country_code=(payload.country_code or "").strip().upper() or None,
        serving_size_g=payload.serving_size_g,
        serving_label=(payload.serving_label or "").strip() or None,
        package_qty_g=payload.package_qty_g,
        basis=payload.basis,
        energy_kcal=payload.energy_kcal,
        protein_g=payload.protein_g,
        carbs_g=payload.carbs_g,
        sugars_g=payload.sugars_g,
        fiber_g=payload.fiber_g,
        fat_g=payload.fat_g,
        sat_fat_g=payload.sat_fat_g,
        trans_fat_g=payload.trans_fat_g,
        sodium_mg=payload.sodium_mg,
        cholesterol_mg=payload.cholesterol_mg,
        micronutrients=payload.micronutrients or None,
        status=status_value,
        verified_count=0,
        created_by_user_id=user.id,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="A product with this barcode already exists."
        ) from err
    db.refresh(row)
    return _serialize_food(row)


@router.patch("/foods/{food_id}", response_model=FoodProductItem)
def update_food_product(
    food_id: uuid.UUID,
    payload: FoodProductUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> FoodProductItem:
    row = db.get(FoodProduct, food_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Food product not found.")

    is_admin_edit = _authorize_food_write(row, user)
    sent = payload.model_fields_set

    simple_fields = (
        "serving_size_g",
        "package_qty_g",
        "basis",
        "energy_kcal",
        "protein_g",
        "carbs_g",
        "sugars_g",
        "fiber_g",
        "fat_g",
        "sat_fat_g",
        "trans_fat_g",
        "sodium_mg",
        "cholesterol_mg",
    )
    for field in simple_fields:
        if field in sent:
            setattr(row, field, getattr(payload, field))

    if "name" in sent and payload.name is not None:
        row.name = payload.name.strip()
    if "brand" in sent:
        row.brand = (payload.brand or "").strip() or None
    if "country_code" in sent:
        row.country_code = (payload.country_code or "").strip().upper() or None
    if "serving_label" in sent:
        row.serving_label = (payload.serving_label or "").strip() or None
    if "micronutrients" in sent:
        row.micronutrients = payload.micronutrients or None

    if is_admin_edit:
        if "status" in sent and payload.status is not None:
            row.status = payload.status
        row.verified_count += 1

    db.commit()
    db.refresh(row)
    return _serialize_food(row)


@router.delete("/foods/{food_id}")
def delete_food_product(
    food_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    row = db.get(FoodProduct, food_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Food product not found.")
    _authorize_food_write(row, user)
    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(food_id)}


# --------------------------------------------------------------------------
# Fotos de producto
# --------------------------------------------------------------------------


class FoodPhotoUploadResponse(BaseModel):
    ok: bool
    kind: PhotoKind
    path: str


def _get_food_or_404(db: DbSession, food_id: uuid.UUID) -> FoodProduct:
    row = db.get(FoodProduct, food_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Food product not found.")
    return row


def _authorize_food_photo_read(row: FoodProduct, user: User) -> None:
    """Un producto global es visible (incluidas sus fotos) para cualquier
    usuario autenticado, aunque su status siga en 'pending'. Uno personal
    solo lo ve su dueno."""
    if row.owner_user_id is None:
        return
    if row.owner_user_id == user.id:
        return
    raise HTTPException(status_code=403, detail="No autorizado para ver esta foto.")


def _authorize_food_photo_write(row: FoodProduct, user: User) -> None:
    """Puede subir/reemplazar fotos: el dueno de un producto personal, quien
    contribuyo un producto pendiente al catalogo compartido, o un admin."""
    if row.owner_user_id == user.id:
        return
    if row.owner_user_id is None and (row.created_by_user_id == user.id or _is_admin(user)):
        return
    raise HTTPException(status_code=403, detail="No autorizado para subir fotos de este alimento.")


def _media_food_dir(product_id: uuid.UUID) -> Path:
    return Path(settings.media_root) / "food" / str(product_id)


@router.post(
    "/foods/{food_id}/photos",
    response_model=FoodPhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_food_photo(
    food_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    kind: Annotated[PhotoKind, Form()],
    file: Annotated[UploadFile, File()],
) -> FoodPhotoUploadResponse:
    row = _get_food_or_404(db, food_id)
    _authorize_food_photo_write(row, user)

    raw = await file.read()
    try:
        jpeg_bytes = validate_and_reencode(raw, file.content_type)
    except InvalidImageError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    # La ruta en disco NUNCA se deriva de entrada del cliente: food_id es un
    # UUID validado por FastAPI y `kind` es un enum cerrado (front|nutrition).
    dest_dir = _media_food_dir(row.id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{kind.value}.jpg"
    dest_path.write_bytes(jpeg_bytes)

    relative_path = f"food/{row.id}/{kind.value}.jpg"
    if kind == PhotoKind.FRONT:
        row.image_front_path = relative_path
    else:
        row.image_nutrition_path = relative_path
    db.commit()

    return FoodPhotoUploadResponse(ok=True, kind=kind, path=relative_path)


@router.get("/foods/{food_id}/photos/{kind}")
def get_food_photo(
    food_id: uuid.UUID,
    kind: PhotoKind,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> FileResponse:
    row = _get_food_or_404(db, food_id)
    _authorize_food_photo_read(row, user)

    dest_path = _media_food_dir(row.id) / f"{kind.value}.jpg"
    if not dest_path.is_file():
        raise HTTPException(status_code=404, detail="Photo not found.")
    return FileResponse(dest_path, media_type="image/jpeg")


# --------------------------------------------------------------------------
# Registro de micronutrientes
# --------------------------------------------------------------------------


class MicronutrientDefinitionResponse(BaseModel):
    key: str
    label: str
    unit: str
    rda: float
    upper_limit: float | None


@router.get("/micronutrients", response_model=list[MicronutrientDefinitionResponse])
def get_micronutrients_registry(
    user: Annotated[User, Depends(get_current_user)],
) -> list[MicronutrientDefinitionResponse]:
    _ = user
    return [
        MicronutrientDefinitionResponse(
            key=item.key,
            label=item.label,
            unit=item.unit,
            rda=item.rda,
            upper_limit=item.upper_limit,
        )
        for item in MICRONUTRIENTS
    ]


# --------------------------------------------------------------------------
# Comidas preestablecidas (presets)
# --------------------------------------------------------------------------


class MealPresetItemPayload(BaseModel):
    food_product_id: str | None = None
    food_name: str = Field(min_length=1, max_length=300)
    quantity_g: float = Field(gt=0, le=5000)
    # La unidad en que se guardo el preset es solo de presentacion: `quantity_g`
    # sigue siendo la que manda al crear las entradas.
    quantity_value: float | None = Field(default=None, gt=0, le=100000)
    quantity_unit: QuantityUnitKey | None = None
    energy_kcal: float | None = Field(default=None, ge=0, le=20000)
    protein_g: float | None = Field(default=None, ge=0, le=2000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    sugars_g: float | None = Field(default=None, ge=0, le=2000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    fat_g: float | None = Field(default=None, ge=0, le=2000)
    sat_fat_g: float | None = Field(default=None, ge=0, le=2000)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    micronutrients: dict[str, float] | None = None


class MealPresetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    meal_slot: MealSlot | None = None
    items: list[MealPresetItemPayload] = Field(min_length=1)


class MealPresetResponseItem(BaseModel):
    id: str
    owner_user_id: str
    name: str
    meal_slot: str | None
    items: list[dict]
    created_at_utc: str
    updated_at_utc: str


def _serialize_preset(row: MealPreset) -> MealPresetResponseItem:
    return MealPresetResponseItem(
        id=str(row.id),
        owner_user_id=str(row.owner_user_id),
        name=row.name,
        meal_slot=row.meal_slot,
        items=row.items or [],
        created_at_utc=row.created_at_utc.isoformat(),
        updated_at_utc=row.updated_at_utc.isoformat(),
    )


@router.get("/presets", response_model=list[MealPresetResponseItem])
def list_meal_presets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> list[MealPresetResponseItem]:
    rows = (
        db.execute(
            select(MealPreset)
            .where(MealPreset.owner_user_id == user.id)
            .order_by(MealPreset.name.asc())
        )
        .scalars()
        .all()
    )
    return [_serialize_preset(row) for row in rows]


@router.post("/presets", response_model=MealPresetResponseItem, status_code=status.HTTP_201_CREATED)
def create_meal_preset(
    payload: MealPresetCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> MealPresetResponseItem:
    items_payload = [item.model_dump() for item in payload.items]
    row = MealPreset(
        owner_user_id=user.id,
        name=payload.name.strip(),
        meal_slot=payload.meal_slot,
        items=items_payload,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="A preset with this name already exists."
        ) from err
    db.refresh(row)
    return _serialize_preset(row)


@router.delete("/presets/{preset_id}")
def delete_meal_preset(
    preset_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    row = db.execute(
        select(MealPreset).where(MealPreset.id == preset_id, MealPreset.owner_user_id == user.id)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Preset not found.")
    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(preset_id)}
