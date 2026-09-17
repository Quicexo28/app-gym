"""Add coach view redesign tables (athlete plan, coach notes/reports, heartbeat, routine index)

Revision ID: a4f8c21e6b93
Revises: f6b2a1c4d803
Create Date: 2026-07-27

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a4f8c21e6b93"
down_revision: Union[str, Sequence[str], None] = "f6b2a1c4d803"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    op.add_column("athletes", sa.Column("display_name", sa.String(length=160), nullable=True))
    op.add_column("athletes", sa.Column("notes", sa.Text(), nullable=True))

    op.add_column(
        "coach_athlete_assignments",
        sa.Column("last_viewed_at_utc", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "athlete_plans",
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("priority_muscle_groups", sa.JSON(), nullable=False),
        sa.Column("updated_by_user_id", sa.UUID(), nullable=True),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("athlete_id"),
    )

    coach_note_scope_enum = postgresql.ENUM(
        "routine_exercise", "programming", name="coach_note_scope_enum"
    )
    coach_note_scope_enum.create(bind, checkfirst=True)

    op.create_table(
        "coach_notes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("author_user_id", sa.UUID(), nullable=False),
        sa.Column(
            "scope_type",
            postgresql.ENUM(
                "routine_exercise", "programming", name="coach_note_scope_enum", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("routine_id", sa.String(), nullable=True),
        sa.Column("exercise_name_normalized", sa.String(length=200), nullable=True),
        sa.Column("assignment_id", sa.UUID(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["assignment_id"], ["cycle_assignments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_coach_notes_athlete_id"), "coach_notes", ["athlete_id"], unique=False)
    op.create_index(
        op.f("ix_coach_notes_author_user_id"), "coach_notes", ["author_user_id"], unique=False
    )
    op.create_index(
        "ix_coach_notes_athlete_scope_lookup",
        "coach_notes",
        ["athlete_id", "scope_type", "routine_id", "exercise_name_normalized"],
        unique=False,
    )

    coach_report_kind_enum = postgresql.ENUM(
        "session_completed", "measurement_taken", name="coach_report_kind_enum"
    )
    coach_report_kind_enum.create(bind, checkfirst=True)

    op.create_table(
        "coach_reports",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column(
            "kind",
            postgresql.ENUM(
                "session_completed",
                "measurement_taken",
                name="coach_report_kind_enum",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("ref_id", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_coach_reports_athlete_id"), "coach_reports", ["athlete_id"], unique=False
    )
    op.create_index(
        "ix_coach_reports_athlete_created",
        "coach_reports",
        ["athlete_id", "created_at_utc"],
        unique=False,
    )

    op.create_table(
        "active_session_heartbeats",
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("started_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_ping_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("routine_id", sa.String(), nullable=True),
        sa.Column("routine_name", sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("athlete_id"),
    )
    op.create_index(
        op.f("ix_active_session_heartbeats_last_ping_at_utc"),
        "active_session_heartbeats",
        ["last_ping_at_utc"],
        unique=False,
    )

    op.create_table(
        "routine_template_exercise_index",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("coach_user_id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("routine_id", sa.String(), nullable=False),
        sa.Column("routine_name", sa.String(length=200), nullable=False),
        sa.Column("template_key", sa.String(length=200), nullable=False),
        sa.Column("exercise_name_normalized", sa.String(length=200), nullable=False),
        sa.Column("muscle_group", sa.String(length=120), nullable=True),
        sa.Column("target_sets_min", sa.Integer(), nullable=True),
        sa.Column("target_sets_max", sa.Integer(), nullable=True),
        sa.Column("target_reps_min", sa.Integer(), nullable=True),
        sa.Column("target_reps_max", sa.Integer(), nullable=True),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["coach_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_routine_template_exercise_index_coach_user_id"),
        "routine_template_exercise_index",
        ["coach_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_routine_template_exercise_index_athlete_id"),
        "routine_template_exercise_index",
        ["athlete_id"],
        unique=False,
    )
    op.create_index(
        "ix_rtei_coach_template",
        "routine_template_exercise_index",
        ["coach_user_id", "template_key"],
        unique=False,
    )
    op.create_index(
        "ix_rtei_coach_exercise",
        "routine_template_exercise_index",
        ["coach_user_id", "exercise_name_normalized"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_index("ix_rtei_coach_exercise", table_name="routine_template_exercise_index")
    op.drop_index("ix_rtei_coach_template", table_name="routine_template_exercise_index")
    op.drop_index(
        op.f("ix_routine_template_exercise_index_athlete_id"),
        table_name="routine_template_exercise_index",
    )
    op.drop_index(
        op.f("ix_routine_template_exercise_index_coach_user_id"),
        table_name="routine_template_exercise_index",
    )
    op.drop_table("routine_template_exercise_index")

    op.drop_index(
        op.f("ix_active_session_heartbeats_last_ping_at_utc"),
        table_name="active_session_heartbeats",
    )
    op.drop_table("active_session_heartbeats")

    op.drop_index("ix_coach_reports_athlete_created", table_name="coach_reports")
    op.drop_index(op.f("ix_coach_reports_athlete_id"), table_name="coach_reports")
    op.drop_table("coach_reports")
    postgresql.ENUM(
        "session_completed", "measurement_taken", name="coach_report_kind_enum"
    ).drop(bind, checkfirst=True)

    op.drop_index("ix_coach_notes_athlete_scope_lookup", table_name="coach_notes")
    op.drop_index(op.f("ix_coach_notes_author_user_id"), table_name="coach_notes")
    op.drop_index(op.f("ix_coach_notes_athlete_id"), table_name="coach_notes")
    op.drop_table("coach_notes")
    postgresql.ENUM("routine_exercise", "programming", name="coach_note_scope_enum").drop(
        bind, checkfirst=True
    )

    op.drop_table("athlete_plans")

    op.drop_column("coach_athlete_assignments", "last_viewed_at_utc")

    op.drop_column("athletes", "notes")
    op.drop_column("athletes", "display_name")
