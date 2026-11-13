"""add_press_hombros_sentado_talones_equipo

Revision ID: c7e1a9d3b605
Revises: b5d8e2f1a374
Create Date: 2026-11-12 13:00:00.000000

Catalogo global:
- Hombros > Press de Hombros (Press Militar): postura Sentado con barra, mancuernas y Smith.
- Pantorrillas > Elevación de Talones Sentado: equipos (máquina, disco).
- Pantorrillas > Elevación de Talones: equipo Con Disco.
Cada equipo nuevo lleva su fila Unilateral, igual que los equipos ya existentes.
Es idempotente: no duplica filas que ya existan.
"""

import unicodedata
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c7e1a9d3b605"
down_revision: Union[str, Sequence[str], None] = "b5d8e2f1a374"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PRESS = "Press de Hombros (Press Militar)"
SENTADO = "Elevación de Talones Sentado"
DE_PIE = "Elevación de Talones"

# (grupo, ejercicio, equipo, variante); "" = nivel vacio.
ROWS = (
    [("Hombros", PRESS, eq, "Sentado") for eq in ("Con Barra", "Con Mancuernas", "En Smith")]
    + [
        ("Pantorrillas", SENTADO, eq, sub)
        for eq in ("Con Disco", "En Máquina")
        for sub in ("", "Unilateral")
    ]
    + [("Pantorrillas", DE_PIE, "Con Disco", sub) for sub in ("", "Unilateral")]
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
