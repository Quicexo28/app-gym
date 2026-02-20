"""add_gamification_config_table

Revision ID: a7f1c9e3b204
Revises: d2c4b8a9f113
Create Date: 2026-02-20 16:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7f1c9e3b204"
down_revision: Union[str, Sequence[str], None] = "d2c4b8a9f113"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gamification_configs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("updated_by_user_id", sa.UUID(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope", name="uq_gamification_config_scope"),
    )
    op.create_index(op.f("ix_gamification_configs_scope"), "gamification_configs", ["scope"], unique=False)
    op.create_index(
        op.f("ix_gamification_configs_updated_by_user_id"),
        "gamification_configs",
        ["updated_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_gamification_configs_updated_by_user_id"), table_name="gamification_configs")
    op.drop_index(op.f("ix_gamification_configs_scope"), table_name="gamification_configs")
    op.drop_table("gamification_configs")
