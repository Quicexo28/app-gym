"""add_coach_athlete_assignments

Revision ID: f4a9c2d1e6b7
Revises: b1e6d8f4a3c2
Create Date: 2026-02-19 21:15:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f4a9c2d1e6b7"
down_revision: Union[str, Sequence[str], None] = "b1e6d8f4a3c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "coach_athlete_assignments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("coach_user_id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.ForeignKeyConstraint(["coach_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("coach_user_id", "athlete_id", name="uq_coach_athlete_assignment"),
    )
    op.create_index(
        op.f("ix_coach_athlete_assignments_athlete_id"),
        "coach_athlete_assignments",
        ["athlete_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coach_athlete_assignments_coach_user_id"),
        "coach_athlete_assignments",
        ["coach_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_coach_athlete_assignments_coach_user_id"), table_name="coach_athlete_assignments")
    op.drop_index(op.f("ix_coach_athlete_assignments_athlete_id"), table_name="coach_athlete_assignments")
    op.drop_table("coach_athlete_assignments")

