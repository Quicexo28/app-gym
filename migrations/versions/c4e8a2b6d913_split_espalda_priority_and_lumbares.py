"""split_espalda_priority_and_lumbares

Revision ID: c4e8a2b6d913
Revises: b3d7f9a1e468
Create Date: 2026-11-12 19:00:00.000000

1) athlete_plans.priority_muscle_groups: el grupo "Espalda" se convierte en
   Dorsales, Espalda Alta y Trapecio (sin duplicar, en el mismo lugar de la lista).
2) Lumbares: los ejercicios de Femorales que cargan la zona lumbar la declaran como
   musculo extra. Peso 1.0 = segundo principal (el ejercicio sale tambien en Lumbares);
   0.5 = secundario.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4e8a2b6d913"
down_revision: Union[str, Sequence[str], None] = "b3d7f9a1e468"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "Espalda"
NEW = ["Dorsales", "Espalda Alta", "Trapecio"]
BACK_GROUPS = {*NEW, "Lumbares"}


def _m(group: str, weight: float) -> dict:
    return {"group": group, "weight": weight}


# (grupo, ejercicio) -> (extras nuevos, extras anteriores)
EXTRAS: dict[tuple[str, str], tuple[list[dict], list[dict]]] = {
    ("Femorales", "Peso Muerto"): (
        [_m("Glúteos", 1.0), _m("Lumbares", 1.0)],
        [_m("Glúteos", 1.0)],
    ),
    ("Femorales", "Peso Muerto Rumano"): (
        [_m("Glúteos", 0.5), _m("Lumbares", 0.5)],
        [_m("Glúteos", 0.5)],
    ),
    ("Femorales", "Peso Muerto Piernas Rígidas"): (
        [_m("Glúteos", 0.5), _m("Lumbares", 0.5)],
        [_m("Glúteos", 0.5)],
    ),
    ("Femorales", "Buenos Días"): (
        [_m("Lumbares", 1.0), _m("Glúteos", 0.5)],
        [_m("Glúteos", 0.5)],
    ),
    ("Femorales", "Hiperextensiones"): (
        [_m("Lumbares", 1.0), _m("Glúteos", 0.5)],
        [_m("Glúteos", 0.5)],
    ),
}


def _rewrite_plans(conn, convert) -> None:
    rows = conn.execute(
        sa.text("SELECT athlete_id, priority_muscle_groups FROM athlete_plans")
    ).fetchall()
    for athlete_id, value in rows:
        groups = json.loads(value) if isinstance(value, str) else value
        if not isinstance(groups, list):
            continue
        new = convert(groups)
        if new != groups:
            conn.execute(
                sa.text(
                    "UPDATE athlete_plans SET priority_muscle_groups = CAST(:v AS json) "
                    "WHERE athlete_id = :id"
                ),
                {"v": json.dumps(new, ensure_ascii=False), "id": athlete_id},
            )


def _split(groups: list) -> list:
    out: list = []
    for group in groups:
        for item in NEW if group == OLD else [group]:
            if item not in out:
                out.append(item)
    return out


def _merge(groups: list) -> list:
    out: list = []
    for group in groups:
        item = OLD if group in BACK_GROUPS else group
        if item not in out:
            out.append(item)
    return out


def _set_extras(conn, index: int) -> None:
    update = sa.text(
        "UPDATE exercise_catalog SET extra_muscles = CAST(:x AS json), updated_at_utc = now() "
        'WHERE owner_user_id IS NULL AND "group" = :g AND family = :f'
    )
    for (group, family), extras in EXTRAS.items():
        conn.execute(
            update,
            {"g": group, "f": family, "x": json.dumps(extras[index], ensure_ascii=False)},
        )


def upgrade() -> None:
    conn = op.get_bind()
    _rewrite_plans(conn, _split)
    _set_extras(conn, 0)


def downgrade() -> None:
    conn = op.get_bind()
    _set_extras(conn, 1)
    _rewrite_plans(conn, _merge)
