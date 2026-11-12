from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.v1.endpoints.diet.common import DbSession, PhotoKind, _is_admin, settings
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import FoodProduct
from app.db.models_auth import User
from app.nutrition.media import InvalidImageError, validate_and_reencode

router = APIRouter()


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
