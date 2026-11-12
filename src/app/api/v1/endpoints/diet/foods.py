from __future__ import annotations

import re
import unicodedata
import uuid
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints.diet.common import DbSession, FoodScope, _is_admin
from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import FoodProduct, MealEntry
from app.db.models_auth import User
from app.nutrition import off_client
from app.nutrition.mapping import (
    map_off_nutriments_to_canonical,
)
from app.nutrition.micronutrients import MICRONUTRIENTS

router = APIRouter()


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
