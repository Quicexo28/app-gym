"""remove_unilateral_catalog_rows

Revision ID: d8a2f5c1b947
Revises: c4e8a2b6d913
Create Date: 2026-11-13 12:00:00.000000

Catalogo global: la lateralidad deja de ser parte de la lista.
- Se borran las filas cuyo nivel termina en "Unilateral". Antes de borrar se asegura que exista
  la fila bilateral equivalente (se crea si falta, con los mismos alias y musculos extra).
- "Unilateral" pasa a ser una propiedad que se activa al agregar el ejercicio; el nombre guardado
  sigue siendo el mismo texto de siempre ("... - Unilateral"), asi el historial coincide.
- Se agrega el alias "Multipower" a Sentadilla en Smith (misma maquina).
Los ejercicios personalizados (owner_user_id no nulo) no se tocan.
Es idempotente. No es reversible: no se recrean las filas unilaterales.
"""

import json
import re
import unicodedata
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d8a2f5c1b947"
down_revision: Union[str, Sequence[str], None] = "c4e8a2b6d913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SUFFIX = re.compile(r"\s*unilateral$", re.IGNORECASE)
SMITH_SQUAT_ALIASES = ["Multipower", "Multi Power"]


def _key(value: str) -> str:
    folded = unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode("ascii")
    return folded.lower()


def _path_key(*parts: str) -> str:
    return "|".join(_key(p) for p in parts)


def _bilateral_parts(variation: str, subvariation: str) -> tuple[str, str] | None:
    """Variante y subvariante del ejercicio bilateral, o None si la fila no es unilateral."""
    if _SUFFIX.search(subvariation):
        return variation, _SUFFIX.sub("", subvariation).strip()
    if _SUFFIX.search(variation):
        return _SUFFIX.sub("", variation).strip(), subvariation
    return None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            'SELECT id, "group", family, variation, subvariation, aliases, extra_muscles '
            "FROM exercise_catalog WHERE owner_user_id IS NULL "
            "AND (variation ILIKE '%unilateral' OR subvariation ILIKE '%unilateral')"
        )
    ).mappings().all()

    exists = sa.text("SELECT 1 FROM exercise_catalog WHERE owner_user_id IS NULL AND path_key = :pk")
    insert = sa.text(
        'INSERT INTO exercise_catalog (id, owner_user_id, path_key, "group", family, variation, '
        "subvariation, aliases, extra_muscles, created_at_utc, updated_at_utc) "
        "VALUES (:id, NULL, :pk, :g, :f, :v, :s, CAST(:al AS json), CAST(:em AS json), now(), now())"
    )
    for row in rows:
        variation = row["variation"] or ""
        subvariation = row["subvariation"] or ""
        parts = _bilateral_parts(variation, subvariation)
        if parts is None:
            continue
        base_variation, base_subvariation = parts
        base_key = _path_key(row["group"], row["family"], base_variation, base_subvariation)
        if not conn.execute(exists, {"pk": base_key}).first():
            conn.execute(
                insert,
                {
                    "id": uuid.uuid4(),
                    "pk": base_key,
                    "g": row["group"],
                    "f": row["family"],
                    "v": base_variation or None,
                    "s": base_subvariation or None,
                    "al": json.dumps(row["aliases"]) if row["aliases"] is not None else None,
                    "em": json.dumps(row["extra_muscles"]) if row["extra_muscles"] is not None else None,
                },
            )
        conn.execute(sa.text("DELETE FROM exercise_catalog WHERE id = :id"), {"id": row["id"]})

    smith = conn.execute(
        sa.text(
            "SELECT id FROM exercise_catalog WHERE owner_user_id IS NULL AND aliases IS NULL "
            "AND path_key LIKE :prefix"
        ),
        {"prefix": _path_key("Cuádriceps", "Sentadilla", "En Smith") + "%"},
    ).all()
    for (row_id,) in smith:
        conn.execute(
            sa.text("UPDATE exercise_catalog SET aliases = CAST(:al AS json) WHERE id = :id"),
            {"al": json.dumps(SMITH_SQUAT_ALIASES), "id": row_id},
        )


def downgrade() -> None:
    # No reversible: las filas unilaterales ya no se listan. Los nombres guardados no cambian.
    pass
