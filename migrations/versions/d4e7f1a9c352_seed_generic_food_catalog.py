"""seed_generic_food_catalog

Revision ID: d4e7f1a9c352
Revises: c1a9e4d7b256
Create Date: 2026-08-12 00:00:00.000000

"""

import uuid
from datetime import UTC, datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e7f1a9c352"
down_revision: Union[str, Sequence[str], None] = "c1a9e4d7b256"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Catalogo global basico (owner_user_id NULL) para que la busqueda de
# alimentos no arranque vacia. Macros por 100 g, valores tipicos de
# referencia (USDA / IEEE food data central), no de un producto puntual.
SEED_FOODS: list[dict] = [
    {"name": "Huevo", "energy_kcal": 143, "protein_g": 12.6, "carbs_g": 0.7, "fat_g": 9.5, "fiber_g": 0, "serving_size_g": 50, "serving_label": "1 huevo mediano"},
    {"name": "Pechuga de pollo", "energy_kcal": 165, "protein_g": 31, "carbs_g": 0, "fat_g": 3.6, "fiber_g": 0},
    {"name": "Carne de res magra", "energy_kcal": 137, "protein_g": 21.2, "carbs_g": 0, "fat_g": 5.4, "fiber_g": 0},
    {"name": "Arroz blanco cocido", "energy_kcal": 130, "protein_g": 2.4, "carbs_g": 28, "fat_g": 0.3, "fiber_g": 0.4},
    {"name": "Arroz integral cocido", "energy_kcal": 123, "protein_g": 2.6, "carbs_g": 25.6, "fat_g": 1.0, "fiber_g": 1.8},
    {"name": "Atun en agua", "energy_kcal": 116, "protein_g": 25.5, "carbs_g": 0, "fat_g": 0.8, "fiber_g": 0},
    {"name": "Avena en hojuelas", "energy_kcal": 389, "protein_g": 16.9, "carbs_g": 66.3, "fat_g": 6.9, "fiber_g": 10.6},
    {"name": "Leche entera", "energy_kcal": 61, "protein_g": 3.2, "carbs_g": 4.8, "fat_g": 3.3, "fiber_g": 0, "basis": "per_100ml"},
    {"name": "Pan tajado integral", "energy_kcal": 247, "protein_g": 13, "carbs_g": 41, "fat_g": 3.4, "fiber_g": 7, "serving_size_g": 25, "serving_label": "1 tajada"},
    {"name": "Banano", "energy_kcal": 89, "protein_g": 1.1, "carbs_g": 22.8, "fat_g": 0.3, "fiber_g": 2.6, "serving_size_g": 118, "serving_label": "1 banano mediano"},
    {"name": "Papa cocida", "energy_kcal": 87, "protein_g": 1.9, "carbs_g": 20.1, "fat_g": 0.1, "fiber_g": 1.8, "serving_size_g": 150, "serving_label": "1 papa mediana"},
    {"name": "Frijol rojo cocido", "energy_kcal": 127, "protein_g": 8.7, "carbs_g": 22.8, "fat_g": 0.5, "fiber_g": 6.4},
    {"name": "Lentejas cocidas", "energy_kcal": 116, "protein_g": 9, "carbs_g": 20.1, "fat_g": 0.4, "fiber_g": 7.9},
    {"name": "Aceite de oliva", "energy_kcal": 884, "protein_g": 0, "carbs_g": 0, "fat_g": 100, "fiber_g": 0},
    {"name": "Mantequilla de mani", "energy_kcal": 588, "protein_g": 25, "carbs_g": 20, "fat_g": 50, "fiber_g": 6},
    {"name": "Yogur griego natural", "energy_kcal": 59, "protein_g": 10, "carbs_g": 3.6, "fat_g": 0.4, "fiber_g": 0},
    {"name": "Queso costeno", "energy_kcal": 330, "protein_g": 22, "carbs_g": 2, "fat_g": 26, "fiber_g": 0},
    {"name": "Aguacate", "energy_kcal": 160, "protein_g": 2, "carbs_g": 8.5, "fat_g": 14.7, "fiber_g": 6.7, "serving_size_g": 200, "serving_label": "1 aguacate mediano"},
    {"name": "Manzana", "energy_kcal": 52, "protein_g": 0.3, "carbs_g": 13.8, "fat_g": 0.2, "fiber_g": 2.4, "serving_size_g": 182, "serving_label": "1 manzana mediana"},
    {"name": "Arveja verde cocida", "energy_kcal": 84, "protein_g": 5.4, "carbs_g": 15.6, "fat_g": 0.2, "fiber_g": 5.5},
    {"name": "Pasta cocida", "energy_kcal": 131, "protein_g": 5, "carbs_g": 25, "fat_g": 1.1, "fiber_g": 1.8},
    {"name": "Tofu firme", "energy_kcal": 144, "protein_g": 15.5, "carbs_g": 3.9, "fat_g": 8.7, "fiber_g": 2.3},
]

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
    now = datetime.now(UTC)
    rows = [
        {
            "id": uuid.uuid4(),
            "owner_user_id": None,
            "barcode": None,
            "source": "seed",
            "name": item["name"],
            "serving_size_g": item.get("serving_size_g"),
            "serving_label": item.get("serving_label"),
            "basis": item.get("basis", "per_100g"),
            "energy_kcal": item["energy_kcal"],
            "protein_g": item["protein_g"],
            "carbs_g": item["carbs_g"],
            "fiber_g": item["fiber_g"],
            "fat_g": item["fat_g"],
            "verified_count": 1,
            "status": "active",
            "created_at_utc": now,
            "updated_at_utc": now,
        }
        for item in SEED_FOODS
    ]
    op.bulk_insert(food_products, rows)


def downgrade() -> None:
    op.execute("DELETE FROM food_products WHERE source = 'seed' AND owner_user_id IS NULL")
