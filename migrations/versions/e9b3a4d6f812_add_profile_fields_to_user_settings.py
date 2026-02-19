"""add_profile_fields_to_user_settings

Revision ID: e9b3a4d6f812
Revises: f4a9c2d1e6b7
Create Date: 2026-02-19 22:05:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e9b3a4d6f812"
down_revision: Union[str, Sequence[str], None] = "f4a9c2d1e6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_settings", sa.Column("profile_username", sa.String(length=64), nullable=True))
    op.add_column("user_settings", sa.Column("profile_bio", sa.String(length=280), nullable=True))
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


def downgrade() -> None:
    op.drop_column("user_settings", "profile_medals")
    op.drop_column("user_settings", "profile_achievements")
    op.drop_column("user_settings", "profile_bio")
    op.drop_column("user_settings", "profile_username")

