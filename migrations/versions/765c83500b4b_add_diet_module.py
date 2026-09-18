"""add_diet_module

Revision ID: 765c83500b4b
Revises: 93309266da4d
Create Date: 2026-08-11 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "765c83500b4b"
down_revision: Union[str, Sequence[str], None] = "93309266da4d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "food_products",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_user_id", sa.UUID(), nullable=True),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.Column("source_ref", sa.String(length=128), nullable=True),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("brand", sa.String(length=200), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("serving_size_g", sa.Float(), nullable=True),
        sa.Column("serving_label", sa.String(length=120), nullable=True),
        sa.Column("package_qty_g", sa.Float(), nullable=True),
        sa.Column("basis", sa.String(length=12), nullable=False),
        sa.Column("energy_kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("sugars_g", sa.Float(), nullable=True),
        sa.Column("fiber_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("sat_fat_g", sa.Float(), nullable=True),
        sa.Column("trans_fat_g", sa.Float(), nullable=True),
        sa.Column("sodium_mg", sa.Float(), nullable=True),
        sa.Column("cholesterol_mg", sa.Float(), nullable=True),
        sa.Column("micronutrients", sa.JSON(), nullable=True),
        sa.Column("image_front_path", sa.String(length=300), nullable=True),
        sa.Column("image_nutrition_path", sa.String(length=300), nullable=True),
        sa.Column("verified_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_food_products_owner_user_id"), "food_products", ["owner_user_id"], unique=False
    )
    op.create_index(op.f("ix_food_products_barcode"), "food_products", ["barcode"], unique=False)
    op.create_index(
        "ix_food_products_owner_name", "food_products", ["owner_user_id", "name"], unique=False
    )
    op.create_index("ix_food_products_name_search", "food_products", ["name"], unique=False)
    op.create_index(
        "ix_food_products_global_barcode",
        "food_products",
        ["barcode"],
        unique=True,
        postgresql_where=sa.text("owner_user_id IS NULL AND barcode IS NOT NULL"),
    )

    op.create_table(
        "meal_entries",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("logged_by_user_id", sa.UUID(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("meal_slot", sa.String(length=16), nullable=False),
        sa.Column("food_product_id", sa.UUID(), nullable=True),
        sa.Column("food_name", sa.String(length=300), nullable=False),
        sa.Column("quantity_g", sa.Float(), nullable=False),
        sa.Column("energy_kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("sugars_g", sa.Float(), nullable=True),
        sa.Column("fiber_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("sat_fat_g", sa.Float(), nullable=True),
        sa.Column("sodium_mg", sa.Float(), nullable=True),
        sa.Column("micronutrients", sa.JSON(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.ForeignKeyConstraint(["logged_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["food_product_id"], ["food_products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_meal_entries_athlete_id"), "meal_entries", ["athlete_id"], unique=False
    )
    op.create_index(
        op.f("ix_meal_entries_logged_by_user_id"),
        "meal_entries",
        ["logged_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_meal_entries_consumed_at"), "meal_entries", ["consumed_at"], unique=False
    )
    op.create_index(
        "ix_meal_entries_athlete_consumed",
        "meal_entries",
        ["athlete_id", "consumed_at"],
        unique=False,
    )

    op.create_table(
        "meal_presets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("meal_slot", sa.String(length=16), nullable=True),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("created_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_meal_presets_owner_user_id"), "meal_presets", ["owner_user_id"], unique=False
    )
    op.create_index(
        "ix_meal_presets_owner_name", "meal_presets", ["owner_user_id", "name"], unique=True
    )

    op.create_table(
        "nutrition_targets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("athlete_id", sa.String(), nullable=False),
        sa.Column("energy_kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("fiber_g", sa.Float(), nullable=True),
        sa.Column("micronutrient_targets", sa.JSON(), nullable=True),
        sa.Column("updated_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.athlete_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("athlete_id", name="uq_nutrition_targets_athlete_id"),
    )


def downgrade() -> None:
    op.drop_table("nutrition_targets")

    op.drop_index("ix_meal_presets_owner_name", table_name="meal_presets")
    op.drop_index(op.f("ix_meal_presets_owner_user_id"), table_name="meal_presets")
    op.drop_table("meal_presets")

    op.drop_index("ix_meal_entries_athlete_consumed", table_name="meal_entries")
    op.drop_index(op.f("ix_meal_entries_consumed_at"), table_name="meal_entries")
    op.drop_index(op.f("ix_meal_entries_logged_by_user_id"), table_name="meal_entries")
    op.drop_index(op.f("ix_meal_entries_athlete_id"), table_name="meal_entries")
    op.drop_table("meal_entries")

    op.drop_index("ix_food_products_global_barcode", table_name="food_products")
    op.drop_index("ix_food_products_name_search", table_name="food_products")
    op.drop_index("ix_food_products_owner_name", table_name="food_products")
    op.drop_index(op.f("ix_food_products_barcode"), table_name="food_products")
    op.drop_index(op.f("ix_food_products_owner_user_id"), table_name="food_products")
    op.drop_table("food_products")
