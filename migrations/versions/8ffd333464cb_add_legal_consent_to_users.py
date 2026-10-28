"""add_legal_consent_to_users

Revision ID: 8ffd333464cb
Revises: 66b5373e5a18
Create Date: 2026-10-28 00:00:00.000000

Consentimiento al crear la cuenta (Ley 1581 de 2012): `legal_version` es la
version de Terminos/Politica aceptada y `legal_accepted_at` cuando, con hora del
servidor. Nullable: las cuentas existentes no tienen registro de consentimiento.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8ffd333464cb"
down_revision: Union[str, Sequence[str], None] = "66b5373e5a18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("legal_version", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("legal_accepted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "legal_accepted_at")
    op.drop_column("users", "legal_version")
