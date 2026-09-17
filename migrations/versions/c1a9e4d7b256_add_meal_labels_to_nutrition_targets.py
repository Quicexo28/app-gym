"""add_meal_labels_to_nutrition_targets

Revision ID: c1a9e4d7b256
Revises: a7941355b2b4
Create Date: 2026-08-11 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1a9e4d7b256"
down_revision: Union[str, Sequence[str], None] = "a7941355b2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("nutrition_targets", sa.Column("meal_labels", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("nutrition_targets", "meal_labels")
