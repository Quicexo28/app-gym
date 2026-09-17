"""seed_tcac_food_catalog

Revision ID: b7d2e5f9a163
Revises: a3f8c6b1d904
Create Date: 2026-08-12 00:00:00.000000

Siembra el catalogo global con los alimentos de la Tabla de Composicion de
Alimentos Colombianos (TCAC) 2018 -- ICBF, extraidos por el pipeline OCR en
scripts/tcac/ hacia data/tcac_2018.json. Ver docs/modulo-dieta.md sec 8 para
el plan y las garantias de calidad (todo lo sembrado paso los 3 invariantes
de validacion del pipeline).

Se excluyen filas cuyo nombre no pudo leerse por OCR (placeholder
"(sin nombre OCR, <codigo>)") -- 5 de 638, inutilizables para un usuario.
"""

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d2e5f9a163"
down_revision: Union[str, Sequence[str], None] = "a3f8c6b1d904"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REPO_ROOT = Path(__file__).resolve().parents[2]
TCAC_JSON_PATH = REPO_ROOT / "data" / "tcac_2018.json"

food_products = sa.table(
    "food_products",
    sa.column("id", sa.UUID()),
    sa.column("owner_user_id", sa.UUID()),
    sa.column("barcode", sa.String()),
    sa.column("source", sa.String()),
    sa.column("source_ref", sa.String()),
    sa.column("name", sa.String()),
    sa.column("country_code", sa.String()),
    sa.column("category", sa.String()),
    sa.column("basis", sa.String()),
    sa.column("energy_kcal", sa.Float()),
    sa.column("protein_g", sa.Float()),
    sa.column("carbs_g", sa.Float()),
    sa.column("fiber_g", sa.Float()),
    sa.column("fat_g", sa.Float()),
    sa.column("sat_fat_g", sa.Float()),
    sa.column("sodium_mg", sa.Float()),
    sa.column("cholesterol_mg", sa.Float()),
    sa.column("micronutrients", sa.JSON()),
    sa.column("verified_count", sa.Integer()),
    sa.column("status", sa.String()),
    sa.column("created_at_utc", sa.DateTime(timezone=True)),
    sa.column("updated_at_utc", sa.DateTime(timezone=True)),
)


def _load_rows() -> list[dict]:
    with TCAC_JSON_PATH.open(encoding="utf-8") as f:
        items = json.load(f)

    now = datetime.now(UTC)
    rows = []
    for item in items:
        if item.get("needs_review"):
            continue
        name = item["nombre"]
        if name.startswith("(sin nombre OCR"):
            continue
        nutrientes = item["nutrientes"]
        rows.append(
            {
                "id": uuid.uuid4(),
                "owner_user_id": None,
                "barcode": None,
                "source": "tcac",
                "source_ref": item["codigo"],
                "name": name,
                "country_code": "CO",
                "category": item["categoria"]["nombre"],
                "basis": "per_100g",
                "energy_kcal": nutrientes.get("energy_kcal"),
                "protein_g": nutrientes.get("protein_g"),
                "carbs_g": nutrientes.get("carbs_g"),
                "fiber_g": nutrientes.get("fiber_g"),
                "fat_g": nutrientes.get("fat_g"),
                "sat_fat_g": nutrientes.get("sat_fat_g"),
                "sodium_mg": nutrientes.get("sodium_mg"),
                "cholesterol_mg": nutrientes.get("cholesterol_mg"),
                "micronutrients": item.get("micronutrients") or {},
                "verified_count": 1,
                "status": "active",
                "created_at_utc": now,
                "updated_at_utc": now,
            }
        )
    return rows


def upgrade() -> None:
    rows = _load_rows()
    if rows:
        op.bulk_insert(food_products, rows)


def downgrade() -> None:
    op.execute("DELETE FROM food_products WHERE source = 'tcac' AND owner_user_id IS NULL")
