"""add_exercise_extra_muscles

Revision ID: a9c4e7b2d815
Revises: f4b9d1e6a273
Create Date: 2026-11-12 17:00:00.000000

Soporte de ejercicios compuestos en el catalogo:
- Columna exercise_catalog.extra_muscles (JSON, nula): [{"group": str, "weight": float}].
  weight 1.0 = segundo musculo principal; 0.5 = musculo secundario.
  `group` sigue siendo el musculo principal.
- Primer compuesto: Pecho > Fondos > Con Peso Corporal, con Tríceps como segundo principal.
Es idempotente en los datos: no duplica filas que ya existan.
"""

import json
import unicodedata
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9c4e7b2d815"
down_revision: Union[str, Sequence[str], None] = "f4b9d1e6a273"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EXTRA = [{"group": "Tríceps", "weight": 1.0}]
# (grupo, ejercicio, equipo, variante, extras)
ROWS = [
    ("Pecho", "Fondos", "", "", EXTRA),
    ("Pecho", "Fondos", "Con Peso Corporal", "", EXTRA),
]


def _key(value: str) -> str:
    folded = unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode("ascii")
    return folded.lower()


def _path_key(*parts: str) -> str:
    return "|".join(_key(p) for p in parts)


def upgrade() -> None:
    op.add_column("exercise_catalog", sa.Column("extra_muscles", sa.JSON(), nullable=True))

    conn = op.get_bind()
    insert = sa.text(
        'INSERT INTO exercise_catalog (id, owner_user_id, path_key, "group", family, variation, '
        "subvariation, aliases, extra_muscles, created_at_utc, updated_at_utc) "
        "VALUES (:id, NULL, :pk, :g, :f, :v, :s, NULL, CAST(:x AS json), now(), now())"
    )
    exists = sa.text(
        "SELECT 1 FROM exercise_catalog WHERE owner_user_id IS NULL AND path_key = :pk"
    )
    for group, family, variation, subvariation, extras in ROWS:
        pk = _path_key(group, family, variation, subvariation)
        if conn.execute(exists, {"pk": pk}).first():
            continue
        conn.execute(
            insert,
            {
                "id": uuid.uuid4(),
                "pk": pk,
                "g": group,
                "f": family,
                "v": variation or None,
                "s": subvariation or None,
                "x": json.dumps(extras, ensure_ascii=False),
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    for group, family, variation, subvariation, _extras in ROWS:
        conn.execute(
            sa.text("DELETE FROM exercise_catalog WHERE owner_user_id IS NULL AND path_key = :pk"),
            {"pk": _path_key(group, family, variation, subvariation)},
        )
    op.drop_column("exercise_catalog", "extra_muscles")
