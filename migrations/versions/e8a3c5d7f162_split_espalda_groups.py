"""split_espalda_groups

Revision ID: e8a3c5d7f162
Revises: d2f6b8a1c490
Create Date: 2026-11-12 15:00:00.000000

Catalogo global: separa el grupo Espalda en
- Dorsales: Dominadas, Jalón al Pecho, Pull Over
- Espalda Alta: Remo, Remo en Barra T, Face Pull, Keenan Flap
- Trapecio: Encogimientos de Trapecio
Lumbares se crea cuando haya ejercicios (el grupo existe solo si tiene filas).
Se recalcula path_key porque incluye el grupo. Los nombres de ejercicio no llevan grupo,
asi que sesiones, rutinas e historial no cambian.
Los ejercicios personalizados (owner_user_id no nulo) no se tocan.
"""

import unicodedata
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e8a3c5d7f162"
down_revision: Union[str, Sequence[str], None] = "d2f6b8a1c490"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_GROUP = "Espalda"
# ejercicio -> grupo nuevo
FAMILY_TO_GROUP = {
    "Dominadas": "Dorsales",
    "Jalón al Pecho": "Dorsales",
    "Pull Over": "Dorsales",
    "Remo": "Espalda Alta",
    "Remo en Barra T": "Espalda Alta",
    "Face Pull": "Espalda Alta",
    "Keenan Flap": "Espalda Alta",
    "Encogimientos de Trapecio": "Trapecio",
}


def _key(value: str) -> str:
    folded = unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode("ascii")
    return folded.lower()


def _path_key(*parts: str) -> str:
    return "|".join(_key(p) for p in parts)


def _move(conn, old_group: str, mapping: dict[str, str], reverse: bool = False) -> None:
    select = sa.text(
        'SELECT id, family, variation, subvariation FROM exercise_catalog '
        'WHERE owner_user_id IS NULL AND "group" = ANY(:groups)'
    )
    groups = list(set(mapping.values())) if reverse else [old_group]
    update = sa.text(
        'UPDATE exercise_catalog SET "group" = :g, path_key = :pk, updated_at_utc = now() '
        "WHERE id = :id"
    )
    for row_id, family, variation, subvariation in conn.execute(
        select, {"groups": groups}
    ).fetchall():
        if family not in mapping:
            continue
        new_group = old_group if reverse else mapping[family]
        conn.execute(
            update,
            {
                "id": row_id,
                "g": new_group,
                "pk": _path_key(new_group, family, variation or "", subvariation or ""),
            },
        )


def upgrade() -> None:
    _move(op.get_bind(), OLD_GROUP, FAMILY_TO_GROUP)


def downgrade() -> None:
    _move(op.get_bind(), OLD_GROUP, FAMILY_TO_GROUP, reverse=True)
