"""Add routine_stores table (server copy of frontend routine store).

Revision ID: c3f2a8b1d074
Revises: b8d1e5f7a920
Create Date: 2026-07-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3f2a8b1d074"
down_revision: Union[str, Sequence[str], None] = "b8d1e5f7a920"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "routine_stores",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("store", sa.JSON(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("routine_stores")
