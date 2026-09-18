"""add_meal_entry_quantity_unit

Guarda la cantidad tal como la escribio el usuario (valor + unidad) al lado de
la cantidad normalizada en `quantity_g`. NULL en las filas existentes: se
interpretan en la unidad base del alimento (ver `app.nutrition.units`).

Revision ID: e7b3f1c8a940
Revises: c4a91e2b7d58
Create Date: 2026-08-23 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e7b3f1c8a940"
down_revision: Union[str, Sequence[str], None] = "c4a91e2b7d58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("meal_entries", sa.Column("quantity_value", sa.Float(), nullable=True))
    op.add_column("meal_entries", sa.Column("quantity_unit", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("meal_entries", "quantity_unit")
    op.drop_column("meal_entries", "quantity_value")
