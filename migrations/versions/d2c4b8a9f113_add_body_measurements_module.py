"""add_body_measurements_module

Revision ID: d2c4b8a9f113
Revises: ab12c3d4e5f6
Create Date: 2026-02-20 13:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2c4b8a9f113"
down_revision: Union[str, Sequence[str], None] = "ab12c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "body_measurements",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("measured_by_user_id", sa.UUID(), nullable=False),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=True),
        sa.Column("height_cm", sa.Float(), nullable=True),
        sa.Column("neck_cm", sa.Float(), nullable=True),
        sa.Column("shoulders_cm", sa.Float(), nullable=True),
        sa.Column("chest_cm", sa.Float(), nullable=True),
        sa.Column("waist_cm", sa.Float(), nullable=True),
        sa.Column("hip_cm", sa.Float(), nullable=True),
        sa.Column("arm_relaxed_cm", sa.Float(), nullable=True),
        sa.Column("arm_flexed_cm", sa.Float(), nullable=True),
        sa.Column("forearm_cm", sa.Float(), nullable=True),
        sa.Column("thigh_cm", sa.Float(), nullable=True),
        sa.Column("calf_cm", sa.Float(), nullable=True),
        sa.Column("body_fat_pct", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.ForeignKeyConstraint(["measured_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_body_measurements_athlete_measured_at",
        "body_measurements",
        ["athlete_id", "measured_at"],
        unique=False,
    )
    op.create_index(op.f("ix_body_measurements_athlete_id"), "body_measurements", ["athlete_id"], unique=False)
    op.create_index(op.f("ix_body_measurements_measured_at"), "body_measurements", ["measured_at"], unique=False)
    op.create_index(
        op.f("ix_body_measurements_measured_by_user_id"),
        "body_measurements",
        ["measured_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_body_measurements_measured_by_user_id"), table_name="body_measurements")
    op.drop_index(op.f("ix_body_measurements_measured_at"), table_name="body_measurements")
    op.drop_index(op.f("ix_body_measurements_athlete_id"), table_name="body_measurements")
    op.drop_index("ix_body_measurements_athlete_measured_at", table_name="body_measurements")
    op.drop_table("body_measurements")
