"""add_prediction_logs

Revision ID: d7e1a4b93c60
Revises: c4f1b7e09a52
Create Date: 2026-09-18 00:00:00.000000

Registro de lo que el motor predice y de lo que pasa despues. Los backtests de
`scripts/backtest/` miden el motor contra el pasado; esta tabla lo mide contra
lo que el usuario realmente vio, que es la unica validacion que no se puede
maquillar.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "d7e1a4b93c60"
down_revision: Union[str, Sequence[str], None] = "c4f1b7e09a52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prediction_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "athlete_id",
            sa.String(),
            sa.ForeignKey("athletes.athlete_id"),
            nullable=False,
            index=True,
        ),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("exercise_name", sa.String(length=200), nullable=True),
        sa.Column("method", sa.String(length=80), nullable=False),
        sa.Column("predicted_value", sa.Float(), nullable=False),
        sa.Column("interval_low", sa.Float(), nullable=True),
        sa.Column("interval_high", sa.Float(), nullable=True),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column("resolved_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_value", sa.Float(), nullable=True),
        sa.Column("inside_interval", sa.Boolean(), nullable=True),
    )
    op.create_index(
        "ix_prediction_logs_athlete_kind", "prediction_logs", ["athlete_id", "kind"]
    )
    op.create_index(
        "ix_prediction_logs_pending", "prediction_logs", ["athlete_id", "resolved_at_utc"]
    )


def downgrade() -> None:
    op.drop_index("ix_prediction_logs_pending", table_name="prediction_logs")
    op.drop_index("ix_prediction_logs_athlete_kind", table_name="prediction_logs")
    op.drop_table("prediction_logs")
