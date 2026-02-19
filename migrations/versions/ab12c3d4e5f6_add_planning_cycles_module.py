"""add_planning_cycles_module

Revision ID: ab12c3d4e5f6
Revises: e9b3a4d6f812
Create Date: 2026-02-20 00:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "ab12c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "e9b3a4d6f812"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    cycle_level_enum = postgresql.ENUM("micro", "meso", "macro", name="cycle_level_enum")
    cycle_status_enum = postgresql.ENUM(
        "draft",
        "active",
        "completed",
        "archived",
        name="cycle_status_enum",
    )
    cycle_start_mode_enum = postgresql.ENUM(
        "auto_on_first_session",
        "manual",
        name="cycle_start_mode_enum",
    )
    cycle_block_status_enum = postgresql.ENUM(
        "pending",
        "completed",
        "not_applicable",
        name="cycle_block_status_enum",
    )

    cycle_level_enum.create(bind, checkfirst=True)
    cycle_status_enum.create(bind, checkfirst=True)
    cycle_start_mode_enum.create(bind, checkfirst=True)
    cycle_block_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "cycle_templates",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_user_id", sa.UUID(), nullable=False),
        sa.Column(
            "level",
            postgresql.ENUM("micro", "meso", "macro", name="cycle_level_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("objective", sa.String(length=280), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "draft",
                "active",
                "completed",
                "archived",
                name="cycle_status_enum",
                create_type=False,
            ),
            nullable=False,
            server_default=sa.text("'draft'::cycle_status_enum"),
        ),
        sa.Column("training_phase", sa.String(length=120), nullable=True),
        sa.Column("nutrition_phase", sa.String(length=120), nullable=True),
        sa.Column("focus_tags", sa.JSON(), nullable=True),
        sa.Column("duration_days", sa.Integer(), nullable=True),
        sa.Column("duration_weeks", sa.Integer(), nullable=True),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_cycle_templates_level"), "cycle_templates", ["level"], unique=False)
    op.create_index(
        op.f("ix_cycle_templates_owner_user_id"),
        "cycle_templates",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_cycle_templates_owner_level",
        "cycle_templates",
        ["owner_user_id", "level"],
        unique=False,
    )

    op.create_table(
        "cycle_template_links",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("parent_template_id", sa.UUID(), nullable=False),
        sa.Column("child_template_id", sa.UUID(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["child_template_id"],
            ["cycle_templates.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_template_id"],
            ["cycle_templates.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "parent_template_id",
            "child_template_id",
            name="uq_cycle_template_link_parent_child",
        ),
        sa.UniqueConstraint(
            "parent_template_id",
            "order_index",
            name="uq_cycle_template_link_parent_order",
        ),
    )
    op.create_index(
        op.f("ix_cycle_template_links_child_template_id"),
        "cycle_template_links",
        ["child_template_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cycle_template_links_parent_template_id"),
        "cycle_template_links",
        ["parent_template_id"],
        unique=False,
    )

    op.create_table(
        "micro_template_blocks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("template_id", sa.UUID(), nullable=False),
        sa.Column("sequence_index", sa.Integer(), nullable=False),
        sa.Column("relative_day", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("objective", sa.String(length=300), nullable=True),
        sa.Column("routine_snapshot", sa.JSON(), nullable=True),
        sa.Column("target_volume", sa.Float(), nullable=True),
        sa.Column("target_intensity", sa.Float(), nullable=True),
        sa.Column("target_fatigue", sa.Float(), nullable=True),
        sa.Column("target_frequency", sa.Float(), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.CheckConstraint("relative_day >= 1", name="ck_micro_template_blocks_relative_day_min1"),
        sa.ForeignKeyConstraint(["template_id"], ["cycle_templates.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("template_id", "sequence_index", name="uq_micro_template_block_template_seq"),
    )
    op.create_index(
        op.f("ix_micro_template_blocks_template_id"),
        "micro_template_blocks",
        ["template_id"],
        unique=False,
    )

    op.create_table(
        "cycle_assignments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("template_id", sa.UUID(), nullable=False),
        sa.Column(
            "level",
            postgresql.ENUM("micro", "meso", "macro", name="cycle_level_enum", create_type=False),
            nullable=False,
        ),
        sa.Column("assigned_by_user_id", sa.UUID(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "draft",
                "active",
                "completed",
                "archived",
                name="cycle_status_enum",
                create_type=False,
            ),
            nullable=False,
            server_default=sa.text("'draft'::cycle_status_enum"),
        ),
        sa.Column(
            "start_mode",
            postgresql.ENUM(
                "auto_on_first_session",
                "manual",
                name="cycle_start_mode_enum",
                create_type=False,
            ),
            nullable=False,
            server_default=sa.text("'auto_on_first_session'::cycle_start_mode_enum"),
        ),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("tolerance_days", sa.Integer(), nullable=False, server_default=sa.text("2")),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default=sa.text("'UTC'")),
        sa.Column("started_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assigned_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.ForeignKeyConstraint(["template_id"], ["cycle_templates.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_cycle_assignments_assigned_by_user_id"),
        "cycle_assignments",
        ["assigned_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cycle_assignments_athlete_id"),
        "cycle_assignments",
        ["athlete_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_cycle_assignments_template_id"),
        "cycle_assignments",
        ["template_id"],
        unique=False,
    )
    op.create_index(
        "ix_cycle_assignments_athlete_level_status",
        "cycle_assignments",
        ["athlete_id", "level", "status"],
        unique=False,
    )

    op.create_table(
        "cycle_assignment_blocks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("assignment_id", sa.UUID(), nullable=False),
        sa.Column("micro_seq", sa.Integer(), nullable=False),
        sa.Column("sequence_index", sa.Integer(), nullable=False),
        sa.Column("relative_day", sa.Integer(), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("objective", sa.String(length=300), nullable=True),
        sa.Column("routine_snapshot", sa.JSON(), nullable=True),
        sa.Column("target_volume", sa.Float(), nullable=True),
        sa.Column("target_intensity", sa.Float(), nullable=True),
        sa.Column("target_fatigue", sa.Float(), nullable=True),
        sa.Column("target_frequency", sa.Float(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending",
                "completed",
                "not_applicable",
                name="cycle_block_status_enum",
                create_type=False,
            ),
            nullable=False,
            server_default=sa.text("'pending'::cycle_block_status_enum"),
        ),
        sa.Column("completed_session_id", sa.UUID(), nullable=True),
        sa.Column("completed_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("relative_day >= 1", name="ck_cycle_assignment_blocks_relative_day_min1"),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["cycle_assignments.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["completed_session_id"], ["sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "assignment_id",
            "sequence_index",
            name="uq_cycle_assignment_block_assignment_seq",
        ),
    )
    op.create_index(
        op.f("ix_cycle_assignment_blocks_assignment_id"),
        "cycle_assignment_blocks",
        ["assignment_id"],
        unique=False,
    )
    op.create_index(
        "ix_cycle_assignment_blocks_assignment_status_target_date",
        "cycle_assignment_blocks",
        ["assignment_id", "status", "target_date"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_index(
        "ix_cycle_assignment_blocks_assignment_status_target_date",
        table_name="cycle_assignment_blocks",
    )
    op.drop_index(op.f("ix_cycle_assignment_blocks_assignment_id"), table_name="cycle_assignment_blocks")
    op.drop_table("cycle_assignment_blocks")

    op.drop_index("ix_cycle_assignments_athlete_level_status", table_name="cycle_assignments")
    op.drop_index(op.f("ix_cycle_assignments_template_id"), table_name="cycle_assignments")
    op.drop_index(op.f("ix_cycle_assignments_athlete_id"), table_name="cycle_assignments")
    op.drop_index(op.f("ix_cycle_assignments_assigned_by_user_id"), table_name="cycle_assignments")
    op.drop_table("cycle_assignments")

    op.drop_index(op.f("ix_micro_template_blocks_template_id"), table_name="micro_template_blocks")
    op.drop_table("micro_template_blocks")

    op.drop_index(op.f("ix_cycle_template_links_parent_template_id"), table_name="cycle_template_links")
    op.drop_index(op.f("ix_cycle_template_links_child_template_id"), table_name="cycle_template_links")
    op.drop_table("cycle_template_links")

    op.drop_index("ix_cycle_templates_owner_level", table_name="cycle_templates")
    op.drop_index(op.f("ix_cycle_templates_owner_user_id"), table_name="cycle_templates")
    op.drop_index(op.f("ix_cycle_templates_level"), table_name="cycle_templates")
    op.drop_table("cycle_templates")

    postgresql.ENUM(
        "pending",
        "completed",
        "not_applicable",
        name="cycle_block_status_enum",
    ).drop(bind, checkfirst=True)
    postgresql.ENUM(
        "auto_on_first_session",
        "manual",
        name="cycle_start_mode_enum",
    ).drop(bind, checkfirst=True)
    postgresql.ENUM(
        "draft",
        "active",
        "completed",
        "archived",
        name="cycle_status_enum",
    ).drop(bind, checkfirst=True)
    postgresql.ENUM("micro", "meso", "macro", name="cycle_level_enum").drop(bind, checkfirst=True)
