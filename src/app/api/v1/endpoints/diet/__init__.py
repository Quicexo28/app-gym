"""Modulo de dieta: un router por tema, unidos bajo `/diet`."""

from fastapi import APIRouter

from app.api.v1.endpoints.diet.common import (  # noqa: F401
    _day_range_utc,
)
from app.api.v1.endpoints.diet.entries import (  # noqa: F401
    MealEntryCreateRequest,
    MealEntryFromPresetRequest,
    MealEntryUpdateRequest,
    _aggregate_daily_totals,
    _escape_like,
    _find_meal_entries_by_batch_ref,
    _find_meal_entry_by_client_ref,
    _resolve_entry_quantity,
    _serialize_entry,
    _snapshot_from_food_product,
    create_entries_from_preset,
    create_meal_entry,
    delete_meal_entry,
    list_meal_entries,
    update_meal_entry,
)
from app.api.v1.endpoints.diet.entries import router as entries_router
from app.api.v1.endpoints.diet.foods import (  # noqa: F401
    _authorize_food_write,
    _looks_like_liquid,
    _serialize_food,
)
from app.api.v1.endpoints.diet.foods import router as foods_router
from app.api.v1.endpoints.diet.photos import (  # noqa: F401
    _authorize_food_photo_read,
    _authorize_food_photo_write,
)
from app.api.v1.endpoints.diet.photos import router as photos_router
from app.api.v1.endpoints.diet.presets import router as presets_router
from app.api.v1.endpoints.diet.targets import (  # noqa: F401
    NutritionTargetPayload,
    get_nutrition_targets,
    put_nutrition_targets,
)
from app.api.v1.endpoints.diet.targets import router as targets_router

router = APIRouter(prefix="/diet", tags=["diet"])
for _sub in (targets_router, entries_router, foods_router, photos_router, presets_router):
    router.include_router(_sub)
