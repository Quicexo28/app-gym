from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import Athlete, BodyMeasurement
from app.db.models_auth import User

router = APIRouter(prefix="/body-metrics", tags=["body-metrics"])
DbSession = Session

_METRIC_KEYS = (
    "weight_kg",
    "height_cm",
    "neck_cm",
    "shoulders_cm",
    "chest_cm",
    "waist_cm",
    "hip_cm",
    "arm_relaxed_cm",
    "arm_flexed_cm",
    "forearm_cm",
    "thigh_cm",
    "calf_cm",
    "body_fat_pct",
)


class BodyMetricDefinition(BaseModel):
    key: str
    label: str
    unit: str
    description: str


class BodyMeasurementCreateRequest(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    measured_at: datetime | None = None
    weight_kg: float | None = Field(default=None, ge=20, le=400)
    height_cm: float | None = Field(default=None, ge=100, le=260)
    neck_cm: float | None = Field(default=None, ge=15, le=90)
    shoulders_cm: float | None = Field(default=None, ge=40, le=220)
    chest_cm: float | None = Field(default=None, ge=40, le=220)
    waist_cm: float | None = Field(default=None, ge=35, le=220)
    hip_cm: float | None = Field(default=None, ge=40, le=220)
    arm_relaxed_cm: float | None = Field(default=None, ge=15, le=80)
    arm_flexed_cm: float | None = Field(default=None, ge=15, le=90)
    forearm_cm: float | None = Field(default=None, ge=12, le=65)
    thigh_cm: float | None = Field(default=None, ge=25, le=120)
    calf_cm: float | None = Field(default=None, ge=20, le=70)
    body_fat_pct: float | None = Field(default=None, ge=2, le=70)
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_has_at_least_one_measure(self) -> BodyMeasurementCreateRequest:
        if any(getattr(self, key) is not None for key in _METRIC_KEYS):
            return self
        raise ValueError("At least one body measurement value is required.")


class BodyMeasurementItem(BaseModel):
    id: str
    athlete_id: str
    measured_by_user_id: str
    measured_at: str
    created_at_utc: str
    weight_kg: float | None
    height_cm: float | None
    neck_cm: float | None
    shoulders_cm: float | None
    chest_cm: float | None
    waist_cm: float | None
    hip_cm: float | None
    arm_relaxed_cm: float | None
    arm_flexed_cm: float | None
    forearm_cm: float | None
    thigh_cm: float | None
    calf_cm: float | None
    body_fat_pct: float | None
    notes: str | None
    bmi: float | None
    waist_to_height_ratio: float | None
    waist_to_hip_ratio: float | None


class BodyMeasurementHistoryResponse(BaseModel):
    athlete_id: str
    total: int
    items: list[BodyMeasurementItem]


def _metric_definitions() -> list[BodyMetricDefinition]:
    return [
        BodyMetricDefinition(
            key="weight_kg",
            label="Peso corporal",
            unit="kg",
            description="Indicador base de tendencia global.",
        ),
        BodyMetricDefinition(
            key="height_cm",
            label="Estatura",
            unit="cm",
            description="Necesaria para calculos como IMC y ratio cintura/estatura.",
        ),
        BodyMetricDefinition(
            key="waist_cm",
            label="Perimetro cintura",
            unit="cm",
            description="Medida prioritaria para composicion corporal y riesgo cardiometabolico.",
        ),
        BodyMetricDefinition(
            key="hip_cm",
            label="Perimetro cadera",
            unit="cm",
            description="Util para ratio cintura/cadera y cambios de composicion.",
        ),
        BodyMetricDefinition(
            key="chest_cm",
            label="Perimetro torax",
            unit="cm",
            description="Seguimiento de tren superior en fases de hipertrofia/definicion.",
        ),
        BodyMetricDefinition(
            key="shoulders_cm",
            label="Perimetro hombros",
            unit="cm",
            description="Control de desarrollo del hombro y proporcion corporal.",
        ),
        BodyMetricDefinition(
            key="neck_cm",
            label="Perimetro cuello",
            unit="cm",
            description="Apoya calculos de composicion con metodos antropometricos.",
        ),
        BodyMetricDefinition(
            key="arm_relaxed_cm",
            label="Perimetro brazo relajado",
            unit="cm",
            description="Seguimiento estable del brazo sin sesgo por bombeo.",
        ),
        BodyMetricDefinition(
            key="arm_flexed_cm",
            label="Perimetro brazo flexionado",
            unit="cm",
            description="Permite evaluar desarrollo muscular del brazo.",
        ),
        BodyMetricDefinition(
            key="forearm_cm",
            label="Perimetro antebrazo",
            unit="cm",
            description="Detalle de progreso en tren superior distal.",
        ),
        BodyMetricDefinition(
            key="thigh_cm",
            label="Perimetro muslo",
            unit="cm",
            description="Control de masa muscular del tren inferior.",
        ),
        BodyMetricDefinition(
            key="calf_cm",
            label="Perimetro pantorrilla",
            unit="cm",
            description="Detalle de progreso del tren inferior distal.",
        ),
        BodyMetricDefinition(
            key="body_fat_pct",
            label="% grasa corporal",
            unit="%",
            description="Estimacion opcional de composicion corporal.",
        ),
    ]


def _normalize_notes(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = " ".join(raw.split()).strip()
    return value or None


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _ensure_athlete_row(db: DbSession, athlete_id: str) -> None:
    if db.get(Athlete, athlete_id) is not None:
        return
    db.add(Athlete(athlete_id=athlete_id))


def _round(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _serialize_item(row: BodyMeasurement) -> BodyMeasurementItem:
    bmi: float | None = None
    if row.weight_kg is not None and row.height_cm is not None and row.height_cm > 0:
        height_m = row.height_cm / 100.0
        bmi = _round(row.weight_kg / (height_m * height_m), 2)

    waist_to_height_ratio: float | None = None
    if row.waist_cm is not None and row.height_cm is not None and row.height_cm > 0:
        waist_to_height_ratio = _round(row.waist_cm / row.height_cm, 4)

    waist_to_hip_ratio: float | None = None
    if row.waist_cm is not None and row.hip_cm is not None and row.hip_cm > 0:
        waist_to_hip_ratio = _round(row.waist_cm / row.hip_cm, 4)

    return BodyMeasurementItem(
        id=str(row.id),
        athlete_id=row.athlete_id,
        measured_by_user_id=str(row.measured_by_user_id),
        measured_at=row.measured_at.isoformat(),
        created_at_utc=row.created_at_utc.isoformat(),
        weight_kg=row.weight_kg,
        height_cm=row.height_cm,
        neck_cm=row.neck_cm,
        shoulders_cm=row.shoulders_cm,
        chest_cm=row.chest_cm,
        waist_cm=row.waist_cm,
        hip_cm=row.hip_cm,
        arm_relaxed_cm=row.arm_relaxed_cm,
        arm_flexed_cm=row.arm_flexed_cm,
        forearm_cm=row.forearm_cm,
        thigh_cm=row.thigh_cm,
        calf_cm=row.calf_cm,
        body_fat_pct=row.body_fat_pct,
        notes=row.notes,
        bmi=bmi,
        waist_to_height_ratio=waist_to_height_ratio,
        waist_to_hip_ratio=waist_to_hip_ratio,
    )


@router.get("/definitions", response_model=list[BodyMetricDefinition])
def get_body_metric_definitions() -> list[BodyMetricDefinition]:
    return _metric_definitions()


@router.get("/{athlete_id}", response_model=BodyMeasurementHistoryResponse)
def get_body_measurements_history(
    athlete_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    limit: int = Query(default=100, ge=1, le=365),
) -> BodyMeasurementHistoryResponse:
    require_athlete_access(db, user, athlete_id)
    normalized_athlete_id = athlete_id.strip()
    rows = (
        db.execute(
            select(BodyMeasurement)
            .where(BodyMeasurement.athlete_id == normalized_athlete_id)
            .order_by(BodyMeasurement.measured_at.desc(), BodyMeasurement.created_at_utc.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    items = [_serialize_item(row) for row in rows]
    return BodyMeasurementHistoryResponse(
        athlete_id=normalized_athlete_id,
        total=len(items),
        items=items,
    )


@router.post("", response_model=BodyMeasurementItem, status_code=status.HTTP_201_CREATED)
def create_body_measurement(
    payload: BodyMeasurementCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> BodyMeasurementItem:
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)

    measured_at = _to_utc(payload.measured_at or datetime.now(UTC))
    _ensure_athlete_row(db, athlete_id)

    row = BodyMeasurement(
        athlete_id=athlete_id,
        measured_by_user_id=user.id,
        measured_at=measured_at,
        weight_kg=payload.weight_kg,
        height_cm=payload.height_cm,
        neck_cm=payload.neck_cm,
        shoulders_cm=payload.shoulders_cm,
        chest_cm=payload.chest_cm,
        waist_cm=payload.waist_cm,
        hip_cm=payload.hip_cm,
        arm_relaxed_cm=payload.arm_relaxed_cm,
        arm_flexed_cm=payload.arm_flexed_cm,
        forearm_cm=payload.forearm_cm,
        thigh_cm=payload.thigh_cm,
        calf_cm=payload.calf_cm,
        body_fat_pct=payload.body_fat_pct,
        notes=_normalize_notes(payload.notes),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize_item(row)
