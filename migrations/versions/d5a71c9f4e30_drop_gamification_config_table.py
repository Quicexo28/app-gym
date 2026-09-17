"""Drop gamification tables/columns (gamification removed from product).

Revision ID: d5a71c9f4e30
Revises: c3f2a8b1d074
Create Date: 2026-07-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d5a71c9f4e30"
down_revision: Union[str, Sequence[str], None] = "c3f2a8b1d074"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f("ix_gamification_configs_updated_by_user_id"), table_name="gamification_configs")
    op.drop_index(op.f("ix_gamification_configs_scope"), table_name="gamification_configs")
    op.drop_table("gamification_configs")

    op.drop_column("user_settings", "profile_medals")
    op.drop_column("user_settings", "profile_achievements")


def downgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "profile_achievements",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "user_settings",
        sa.Column(
            "profile_medals",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )

    op.create_table(
        "gamification_configs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("updated_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["users.id"],
            name="gamification_configs_updated_by_user_id_fkey",
            ondelete="SET NULL",
        ),
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
