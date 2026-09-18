"""Add coach invite and billing tables

Revision ID: 93309266da4d
Revises: a4f8c21e6b93
Create Date: 2026-07-28

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "93309266da4d"
down_revision: Union[str, Sequence[str], None] = "a4f8c21e6b93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "coach_profiles",
        sa.Column("coach_user_id", sa.UUID(), nullable=False),
        sa.Column("invite_code", sa.String(length=16), nullable=False),
        sa.Column("invite_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["coach_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("coach_user_id"),
    )
    op.create_index(
        op.f("ix_coach_profiles_invite_code"), "coach_profiles", ["invite_code"], unique=True
    )

    coach_billing_status_enum = postgresql.ENUM(
        "none", "active", "past_due", "canceled", name="coach_billing_status_enum"
    )
    coach_billing_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "coach_billing",
        sa.Column("coach_user_id", sa.UUID(), nullable=False),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_base_item_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_seat_item_id", sa.String(length=255), nullable=True),
        sa.Column("extra_seats", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "none", "active", "past_due", "canceled",
                name="coach_billing_status_enum", create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["coach_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("coach_user_id"),
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_table("coach_billing")
    postgresql.ENUM(
        "none", "active", "past_due", "canceled", name="coach_billing_status_enum"
    ).drop(bind, checkfirst=True)

    op.drop_index(op.f("ix_coach_profiles_invite_code"), table_name="coach_profiles")
    op.drop_table("coach_profiles")
