"""add_account_profile_fields

Revision ID: f6b2a1c4d803
Revises: e1c7d3b95a24
Create Date: 2026-07-25 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f6b2a1c4d803"
down_revision: Union[str, Sequence[str], None] = "e1c7d3b95a24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_settings", sa.Column("profile_display_name", sa.String(length=64), nullable=True)
    )
    op.add_column("user_settings", sa.Column("profile_birth_date", sa.Date(), nullable=True))
    op.add_column("user_settings", sa.Column("profile_gender", sa.String(length=16), nullable=True))
    op.add_column("user_settings", sa.Column("profile_height_cm", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_settings", "profile_height_cm")
    op.drop_column("user_settings", "profile_gender")
    op.drop_column("user_settings", "profile_birth_date")
    op.drop_column("user_settings", "profile_display_name")
