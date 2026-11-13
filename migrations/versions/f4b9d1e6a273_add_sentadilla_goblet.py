"""add_sentadilla_goblet

Revision ID: f4b9d1e6a273
Revises: e8a3c5d7f162
Create Date: 2026-11-12 16:00:00.000000

Catalogo global: agrega Cuádriceps > Sentadilla Goblet, sin nivel de equipo.
Goblet es la unica sentadilla con mancuernas, por eso es ejercicio propio
(igual que Sentadilla Búlgara) y no una variante de Sentadilla.
Es idempotente: no duplica filas que ya existan.
"""

import unicodedata
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f4b9d1e6a273"
down_revision: Union[str, Sequence[str], None] = "e8a3c5d7f162"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (grupo, ejercicio, equipo, variante); "" = nivel vacio.
ROWS = [
    ("Cuádriceps", "Sentadilla Goblet", "", ""),
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
