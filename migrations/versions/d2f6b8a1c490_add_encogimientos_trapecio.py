"""add_encogimientos_trapecio

Revision ID: d2f6b8a1c490
Revises: c7e1a9d3b605
Create Date: 2026-11-12 14:00:00.000000

Catalogo global: agrega Espalda > Encogimientos de Trapecio
(Con Barra, Con Mancuernas, En Máquina, En Smith).
Es idempotente: no duplica filas que ya existan.
"""

import unicodedata
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d2f6b8a1c490"
down_revision: Union[str, Sequence[str], None] = "c7e1a9d3b605"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (grupo, ejercicio, equipo, variante); "" = nivel vacio.
ROWS = [("Espalda", "Encogimientos de Trapecio", "", "")] + [
    ("Espalda", "Encogimientos de Trapecio", eq, "")
    for eq in ("Con Barra", "Con Mancuernas", "En Máquina", "En Smith")
]


def _key(value: str) -> str:
    folded = unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode("ascii")
    return folded.lower()


def _path_key(*parts: str) -> str:
    return "|".join(_key(p) for p in parts)


def upgrade() -> None:
    conn = op.get_bind()
    insert = sa.text(
        'INSERT INTO exercise_catalog (id, owner_user_id, path_key, "group", family, variation, '
        "subvariation, aliases, created_at_utc, updated_at_utc) "
        "VALUES (:id, NULL, :pk, :g, :f, :v, :s, NULL, now(), now())"
    )
    exists = sa.text(
        "SELECT 1 FROM exercise_catalog WHERE owner_user_id IS NULL AND path_key = :pk"
    )
    for group, family, variation, subvariation in ROWS:
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
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    for group, family, variation, subvariation in ROWS:
        conn.execute(
            sa.text("DELETE FROM exercise_catalog WHERE owner_user_id IS NULL AND path_key = :pk"),
            {"pk": _path_key(group, family, variation, subvariation)},
        )
