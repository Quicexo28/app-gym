"""add_category_to_food_products

Revision ID: a3f8c6b1d904
Revises: d4e7f1a9c352
Create Date: 2026-08-12 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3f8c6b1d904"
down_revision: Union[str, Sequence[str], None] = "d4e7f1a9c352"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("food_products", sa.Column("category", sa.String(length=80), nullable=True))
    op.create_index(
        op.f("ix_food_products_category"), "food_products", ["category"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_food_products_category"), table_name="food_products")
    op.drop_column("food_products", "category")
