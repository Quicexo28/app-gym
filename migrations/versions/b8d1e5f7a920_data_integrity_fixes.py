"""Data integrity fixes: SET NULL FKs and integer session counters.

Revision ID: b8d1e5f7a920
Revises: a7f1c9e3b204
Create Date: 2026-07-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8d1e5f7a920"
down_revision: Union[str, Sequence[str], None] = "a7f1c9e3b204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # gamification_configs.updated_by_user_id: nullable + ON DELETE SET NULL
    op.alter_column(
        "gamification_configs",
        "updated_by_user_id",
        existing_type=sa.UUID(),
        nullable=True,
    )
    op.drop_constraint(
        "gamification_configs_updated_by_user_id_fkey",
        "gamification_configs",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "gamification_configs_updated_by_user_id_fkey",
        "gamification_configs",
        "users",
        ["updated_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # cycle_assignment_blocks.completed_session_id: ON DELETE SET NULL
    op.drop_constraint(
        "cycle_assignment_blocks_completed_session_id_fkey",
        "cycle_assignment_blocks",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "cycle_assignment_blocks_completed_session_id_fkey",
        "cycle_assignment_blocks",
        "sessions",
        ["completed_session_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # sessions.sets_total / reps_total: float -> integer (son conteos)
    op.alter_column(
        "sessions",
        "sets_total",
        existing_type=sa.Float(),
        type_=sa.Integer(),
        existing_nullable=True,
        postgresql_using="round(sets_total)::integer",
    )
    op.alter_column(
        "sessions",
        "reps_total",
        existing_type=sa.Float(),
        type_=sa.Integer(),
        existing_nullable=True,
        postgresql_using="round(reps_total)::integer",
    )


def downgrade() -> None:
    op.alter_column(
        "sessions",
        "reps_total",
        existing_type=sa.Integer(),
        type_=sa.Float(),
        existing_nullable=True,
    )
    op.alter_column(
        "sessions",
        "sets_total",
        existing_type=sa.Integer(),
        type_=sa.Float(),
        existing_nullable=True,
    )

    op.drop_constraint(
        "cycle_assignment_blocks_completed_session_id_fkey",
        "cycle_assignment_blocks",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "cycle_assignment_blocks_completed_session_id_fkey",
        "cycle_assignment_blocks",
        "sessions",
        ["completed_session_id"],
        ["id"],
    )

    op.drop_constraint(
        "gamification_configs_updated_by_user_id_fkey",
        "gamification_configs",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "gamification_configs_updated_by_user_id_fkey",
        "gamification_configs",
        "users",
        ["updated_by_user_id"],
        ["id"],
    )
    op.execute(
        "UPDATE gamification_configs SET updated_by_user_id = (SELECT id FROM users LIMIT 1) "
        "WHERE updated_by_user_id IS NULL"
    )
    op.alter_column(
        "gamification_configs",
        "updated_by_user_id",
        existing_type=sa.UUID(),
        nullable=False,
    )
