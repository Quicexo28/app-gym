"""add_curl_mancuernas_postura

Revision ID: b5d8e2f1a374
Revises: a3c7e1d94b52
Create Date: 2026-11-12 12:00:00.000000

Agrega al catalogo global la ruta pedida:
    Bíceps > Curl con Mancuernas > Sentado / De Pie > Unilateral / Bilateral / Alternado
Niveles: grupo, ejercicio, postura (variation), lateralidad (subvariation).
Es idempotente: no duplica filas que ya existan.
"""

import unicodedata
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b5d8e2f1a374"
down_revision: Union[str, Sequence[str], None] = "a3c7e1d94b52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GROUP = "Bíceps"
FAMILY = "Curl con Mancuernas"
POSTURES = ["Sentado", "De Pie"]
LATERALITIES = ["Unilateral", "Bilateral", "Alternado"]
ROWS = (
    [("", "")]
    + [(p, "") for p in POSTURES]
    + [(p, lat) for p in POSTURES for lat in LATERALITIES]
)


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
    for var, sub in ROWS:
        pk = _path_key(GROUP, FAMILY, var, sub)
        if conn.execute(exists, {"pk": pk}).first():
            continue
        conn.execute(
            insert,
            {
                "id": uuid.uuid4(),
                "pk": pk,
                "g": GROUP,
                "f": FAMILY,
                "v": var or None,
                "s": sub or None,
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    for var, sub in ROWS:
        conn.execute(
            sa.text("DELETE FROM exercise_catalog WHERE owner_user_id IS NULL AND path_key = :pk"),
            {"pk": _path_key(GROUP, FAMILY, var, sub)},
        )
