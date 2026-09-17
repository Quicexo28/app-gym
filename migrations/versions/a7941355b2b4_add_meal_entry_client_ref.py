"""add_meal_entry_client_ref

Revision ID: a7941355b2b4
Revises: 765c83500b4b
Create Date: 2026-08-11 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7941355b2b4"
down_revision: Union[str, Sequence[str], None] = "765c83500b4b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("meal_entries", sa.Column("client_ref", sa.String(length=64), nullable=True))
    op.create_index(
        "ix_meal_entries_athlete_client_ref",
        "meal_entries",
        ["athlete_id", "client_ref"],
        unique=True,
        postgresql_where=sa.text("client_ref IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_meal_entries_athlete_client_ref", table_name="meal_entries")
    op.drop_column("meal_entries", "client_ref")
