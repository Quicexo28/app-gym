from __future__ import annotations

from datetime import UTC, datetime, timedelta
from datetime import date as date_cls
from enum import StrEnum
from typing import Literal

from sqlalchemy.orm import Session

from app.auth.types import Role
from app.auth.view_scopes import effective_role_for_scopes, get_current_view_scopes
from app.core.config import Settings
from app.db.models_auth import User

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


def _is_admin(user: User) -> bool:
    return effective_role_for_scopes(user, get_current_view_scopes()) == Role.ADMIN


def _day_range_utc(day: date_cls) -> tuple[datetime, datetime]:
    """Limites [inicio, fin) de un dia calendario en UTC."""
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return start, start + timedelta(days=1)


# --------------------------------------------------------------------------
