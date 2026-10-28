"""add_apple_sign_in_fields

Revision ID: 66b5373e5a18
Revises: e2c8b5a71f43
Create Date: 2026-10-28 00:00:00.000000

Sign in with Apple: `apple_sub` identifica al usuario de Apple y
`apple_refresh_token` permite revocar el token al borrar la cuenta.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "66b5373e5a18"
down_revision: Union[str, Sequence[str], None] = "e2c8b5a71f43"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("apple_sub", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("apple_refresh_token", sa.Text(), nullable=True))
    op.create_index(op.f("ix_users_apple_sub"), "users", ["apple_sub"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_apple_sub"), table_name="users")
    op.drop_column("users", "apple_refresh_token")
    op.drop_column("users", "apple_sub")
