"""seed_extra_muscles

Revision ID: b3d7f9a1e468
Revises: a9c4e7b2d815
Create Date: 2026-11-12 18:00:00.000000

Carga musculos extra en los ejercicios compuestos del catalogo global.
weight 1.0 = segundo musculo principal (el ejercicio sale tambien en ese grupo);
weight 0.5 = musculo secundario. Los ejercicios no listados quedan sin extras.
Solo toca filas globales y sobrescribe extra_muscles de las familias listadas.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3d7f9a1e468"
down_revision: Union[str, Sequence[str], None] = "a9c4e7b2d815"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _m(group: str, weight: float) -> dict:
    return {"group": group, "weight": weight}


# (grupo, ejercicio) -> musculos extra
EXTRAS: dict[tuple[str, str], list[dict]] = {
    ("Pecho", "Press"): [_m("Tríceps", 0.5), _m("Hombros", 0.5)],
    ("Hombros", "Press de Hombros (Press Militar)"): [_m("Tríceps", 0.5)],
    ("Hombros", "Vuelos Posteriores"): [_m("Espalda Alta", 0.5)],
    ("Tríceps", "Press Cerrado"): [_m("Pecho", 0.5), _m("Hombros", 0.5)],
    ("Dorsales", "Dominadas"): [_m("Bíceps", 0.5)],
    ("Dorsales", "Jalón al Pecho"): [_m("Bíceps", 0.5)],
    ("Dorsales", "Pull Over"): [_m("Pecho", 0.5)],
    ("Espalda Alta", "Remo"): [_m("Dorsales", 1.0), _m("Bíceps", 0.5)],
    ("Espalda Alta", "Remo en Barra T"): [_m("Dorsales", 1.0), _m("Bíceps", 0.5)],
    ("Espalda Alta", "Face Pull"): [_m("Hombros", 1.0)],
    ("Cuádriceps", "Sentadilla"): [_m("Glúteos", 0.5)],
    ("Cuádriceps", "Sentadilla Búlgara"): [_m("Glúteos", 0.5)],
    ("Cuádriceps", "Sentadilla Goblet"): [_m("Glúteos", 0.5)],
    ("Cuádriceps", "Prensa de Piernas"): [_m("Glúteos", 0.5)],
    ("Femorales", "Peso Muerto"): [_m("Glúteos", 1.0)],
    ("Femorales", "Peso Muerto Rumano"): [_m("Glúteos", 0.5)],
    ("Femorales", "Peso Muerto Piernas Rígidas"): [_m("Glúteos", 0.5)],
    ("Femorales", "Buenos Días"): [_m("Glúteos", 0.5)],
    ("Femorales", "Hiperextensiones"): [_m("Glúteos", 0.5)],
    ("Glúteos", "Hip Thrust"): [_m("Femorales", 0.5)],
    ("Glúteos", "Puente de Glúteos"): [_m("Femorales", 0.5)],
}


def upgrade() -> None:
    conn = op.get_bind()
    update = sa.text(
        "UPDATE exercise_catalog SET extra_muscles = CAST(:x AS json), updated_at_utc = now() "
        'WHERE owner_user_id IS NULL AND "group" = :g AND family = :f'
    )
    for (group, family), extras in EXTRAS.items():
        conn.execute(
            update, {"g": group, "f": family, "x": json.dumps(extras, ensure_ascii=False)}
        )


def downgrade() -> None:
    conn = op.get_bind()
    clear = sa.text(
        "UPDATE exercise_catalog SET extra_muscles = NULL, updated_at_utc = now() "
        'WHERE owner_user_id IS NULL AND "group" = :g AND family = :f'
    )
    for group, family in EXTRAS:
        conn.execute(clear, {"g": group, "f": family})
