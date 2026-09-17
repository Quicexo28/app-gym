"""Add progress shares module (coach <-> athlete progress reports).

Revision ID: e1c7d3b95a24
Revises: d5a71c9f4e30
Create Date: 2026-07-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e1c7d3b95a24"
down_revision: Union[str, Sequence[str], None] = "d5a71c9f4e30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "progress_shares",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("author_user_id", sa.UUID(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_progress_shares_athlete_id", "progress_shares", ["athlete_id"])
    op.create_index("ix_progress_shares_author_user_id", "progress_shares", ["author_user_id"])
    op.create_index(
        "ix_progress_shares_athlete_created",
        "progress_shares",
        ["athlete_id", "created_at_utc"],
    )

    op.create_table(
        "progress_share_comments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("share_id", sa.UUID(), nullable=False),
        sa.Column("author_user_id", sa.UUID(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["share_id"], ["progress_shares.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_progress_share_comments_share_id", "progress_share_comments", ["share_id"])
    op.create_index(
        "ix_progress_share_comments_author_user_id",
        "progress_share_comments",
        ["author_user_id"],
    )
    op.create_index(
        "ix_progress_share_comments_share_created",
        "progress_share_comments",
        ["share_id", "created_at_utc"],
    )


def downgrade() -> None:
    op.drop_index("ix_progress_share_comments_share_created", table_name="progress_share_comments")
    op.drop_index(
        "ix_progress_share_comments_author_user_id", table_name="progress_share_comments"
    )
    op.drop_index("ix_progress_share_comments_share_id", table_name="progress_share_comments")
    op.drop_table("progress_share_comments")

    op.drop_index("ix_progress_shares_athlete_created", table_name="progress_shares")
    op.drop_index("ix_progress_shares_author_user_id", table_name="progress_shares")
    op.drop_index("ix_progress_shares_athlete_id", table_name="progress_shares")
    op.drop_table("progress_shares")
