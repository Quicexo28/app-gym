"""add_serving_size_pan_arepa

Revision ID: 9bcfa6c7e0cf
Revises: e7b3f1c8a940
Create Date: 2026-08-24 00:00:00.000000

"""

import uuid
from datetime import UTC, datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9bcfa6c7e0cf"
down_revision: Union[str, Sequence[str], None] = "e7b3f1c8a940"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# "Pan tajado integral" quedo sembrado sin porcion (d4e7f1a9c352): sin
# serving_size_g el selector de unidades no ofrece "porcion" (ver
# `unitsForFood` en frontend/src/lib/nutrition/units.ts), y es un alimento que
# la gente cuenta por tajada, no por gramo. 25 g es el peso tipico de una
# tajada de pan integral comercial (Bimbo/Ekono).
PAN_TAJADO_SERVING_G = 25.0
PAN_TAJADO_SERVING_LABEL = "1 tajada"

# "Arepa" no existia en el catalogo semilla. Macros por 100 g de la TCAC 2018
# (data/tcac_2018.json, codigo A004, "Arepa de maiz precocido, con sal").
# 80 g es el peso tipico de una arepa mediana asada.
AREPA_ROW = {
    "name": "Arepa de maiz asada",
    "energy_kcal": 163.0,
    "protein_g": 3.3,
    "carbs_g": 35.0,
    "fat_g": 0.9,
    "fiber_g": 0.9,
    "serving_size_g": 80.0,
    "serving_label": "1 arepa mediana",
}

food_products = sa.table(
    "food_products",
    sa.column("id", sa.UUID()),
    sa.column("owner_user_id", sa.UUID()),
    sa.column("barcode", sa.String()),
    sa.column("source", sa.String()),
    sa.column("name", sa.String()),
    sa.column("serving_size_g", sa.Float()),
    sa.column("serving_label", sa.String()),
    sa.column("basis", sa.String()),
    sa.column("energy_kcal", sa.Float()),
    sa.column("protein_g", sa.Float()),
    sa.column("carbs_g", sa.Float()),
    sa.column("fiber_g", sa.Float()),
    sa.column("fat_g", sa.Float()),
    sa.column("verified_count", sa.Integer()),
    sa.column("status", sa.String()),
    sa.column("created_at_utc", sa.DateTime(timezone=True)),
    sa.column("updated_at_utc", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    op.execute(
        food_products.update()
        .where(food_products.c.source == "seed")
        .where(food_products.c.owner_user_id.is_(None))
        .where(food_products.c.name == "Pan tajado integral")
        .values(
            serving_size_g=PAN_TAJADO_SERVING_G,
            serving_label=PAN_TAJADO_SERVING_LABEL,
            updated_at_utc=datetime.now(UTC),
        )
    )

    now = datetime.now(UTC)
    op.bulk_insert(
        food_products,
        [
            {
                "id": uuid.uuid4(),
                "owner_user_id": None,
                "barcode": None,
                "source": "seed",
                "name": AREPA_ROW["name"],
                "serving_size_g": AREPA_ROW["serving_size_g"],
                "serving_label": AREPA_ROW["serving_label"],
                "basis": "per_100g",
                "energy_kcal": AREPA_ROW["energy_kcal"],
                "protein_g": AREPA_ROW["protein_g"],
                "carbs_g": AREPA_ROW["carbs_g"],
                "fiber_g": AREPA_ROW["fiber_g"],
                "fat_g": AREPA_ROW["fat_g"],
                "verified_count": 1,
                "status": "active",
                "created_at_utc": now,
                "updated_at_utc": now,
            }
        ],
    )


def downgrade() -> None:
    op.execute(
        food_products.update()
        .where(food_products.c.source == "seed")
        .where(food_products.c.owner_user_id.is_(None))
        .where(food_products.c.name == "Pan tajado integral")
        .values(serving_size_g=None, serving_label=None)
    )
    op.execute(
        f"DELETE FROM food_products WHERE source = 'seed' AND owner_user_id IS NULL "
        f"AND name = '{AREPA_ROW['name']}'"
    )
