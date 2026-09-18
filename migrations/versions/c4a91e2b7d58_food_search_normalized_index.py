"""food_search_normalized_index

Revision ID: c4a91e2b7d58
Revises: b7d2e5f9a163
Create Date: 2026-08-12 00:00:00.000000

La busqueda de alimentos comparaba el termino crudo contra el nombre completo
(`name ILIKE '%termino%'`), asi que "huevos" no encontraba "Huevo de gallina"
y "platano" no encontraba "Platano africa". El endpoint pasa a buscar por
tokens normalizados (minusculas, sin tildes); aqui se instala el lado SQL de
esa normalizacion:

- `unaccent` + un wrapper IMMUTABLE, porque `unaccent()` es STABLE y Postgres
  no acepta funciones STABLE dentro de un indice.
- indice GIN trigram sobre la expresion normalizada: el `LIKE '%token%'` lleva
  comodin a la izquierda, que un btree no puede usar.

Ambas extensiones son "trusted" desde Postgres 13, asi que las crea el dueno
de la base sin necesitar superusuario.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4a91e2b7d58"
down_revision: Union[str, Sequence[str], None] = "b7d2e5f9a163"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    # El segundo argumento fija el diccionario, que es lo que permite declarar
    # el wrapper IMMUTABLE sin mentir: deja de depender del search_path.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION immutable_unaccent(text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE STRICT PARALLEL SAFE
        AS $$ SELECT public.unaccent('public.unaccent', $1) $$
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_food_products_name_norm_trgm
        ON food_products
        USING gin (immutable_unaccent(lower(name)) gin_trgm_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_food_products_name_norm_trgm")
    op.execute("DROP FUNCTION IF EXISTS immutable_unaccent(text)")
    # Las extensiones se dejan instaladas: otras cosas pueden depender de ellas
    # y borrarlas es mas destructivo que el cambio que esta migracion introdujo.
