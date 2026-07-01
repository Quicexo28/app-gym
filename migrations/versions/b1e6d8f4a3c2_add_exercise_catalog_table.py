"""add_exercise_catalog_table

Revision ID: b1e6d8f4a3c2
Revises: 8f7cbf2e9d56
Create Date: 2026-02-18 19:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b1e6d8f4a3c2"
down_revision: Union[str, Sequence[str], None] = "8f7cbf2e9d56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "exercise_catalog",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_user_id", sa.UUID(), nullable=True),
        sa.Column("path_key", sa.String(length=512), nullable=False),
        sa.Column("group", sa.String(length=120), nullable=False),
        sa.Column("family", sa.String(length=160), nullable=False),
        sa.Column("variation", sa.String(length=160), nullable=True),
        sa.Column("subvariation", sa.String(length=180), nullable=True),
        sa.Column("aliases", sa.JSON(), nullable=True),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(op.f("ix_exercise_catalog_owner_user_id"), "exercise_catalog", ["owner_user_id"], unique=False)
    op.create_index(op.f("ix_exercise_catalog_path_key"), "exercise_catalog", ["path_key"], unique=False)

    op.create_index(
        "ix_exercise_catalog_global_path_key",
        "exercise_catalog",
        ["path_key"],
        unique=True,
        postgresql_where=sa.text("owner_user_id IS NULL"),
    )
    op.create_index(
        "ix_exercise_catalog_custom_owner_path_key",
        "exercise_catalog",
        ["owner_user_id", "path_key"],
        unique=True,
        postgresql_where=sa.text("owner_user_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_exercise_catalog_custom_owner_path_key", table_name="exercise_catalog")
    op.drop_index("ix_exercise_catalog_global_path_key", table_name="exercise_catalog")
    op.drop_index(op.f("ix_exercise_catalog_path_key"), table_name="exercise_catalog")
    op.drop_index(op.f("ix_exercise_catalog_owner_user_id"), table_name="exercise_catalog")
    op.drop_table("exercise_catalog")
