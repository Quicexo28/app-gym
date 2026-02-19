from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.athlete_access import can_switch_athlete, list_accessible_athlete_ids
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models_auth import User

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/athletes", tags=["athletes"])


class AccessibleAthletesResponse(BaseModel):
    can_switch: bool
    athlete_ids: list[str]


@router.get("/accessible", response_model=AccessibleAthletesResponse)
def accessible_athletes(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> AccessibleAthletesResponse:
    return AccessibleAthletesResponse(
        can_switch=can_switch_athlete(user),
        athlete_ids=list_accessible_athlete_ids(db, user),
    )

