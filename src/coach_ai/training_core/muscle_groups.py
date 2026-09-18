from __future__ import annotations

import unicodedata

# Mismo orden y tokens que MUSCLE_GROUP_DISPLAY_ORDER en
# frontend/src/lib/exerciseCatalog.ts, para que la agregacion por musculo del
# motor ML use la misma taxonomia que ya ordena las cards del catalogo.
_MUSCLE_GROUP_TOKENS: list[tuple[str, tuple[str, ...]]] = [
    ("Hombros", ("hombro", "hombros", "deltoide", "deltoides")),
    ("Biceps", ("bicep", "biceps")),
    ("Triceps", ("tricep", "triceps")),
    ("Pecho", ("pecho", "pectoral", "pectorales")),
    ("Espalda", ("espalda", "dorsal", "dorsales", "trapecio", "trapecios")),
    ("Abdomen", ("abdomen", "abdominales", "abdominal", "core")),
    ("Gluteos", ("gluteo", "gluteos")),
    ("Abductores", ("abductor", "abductores")),
    ("Aductores", ("aductor", "aductores")),
    ("Cuadriceps", ("cuadricep", "cuadriceps")),
    ("Femorales", ("femoral", "femorales", "isquiotibial", "isquiotibiales")),
    ("Pantorrillas", ("pantorrilla", "pantorrillas", "gemelo", "gemelos")),
]

MUSCLE_GROUPS: list[str] = [label for label, _tokens in _MUSCLE_GROUP_TOKENS]

_TOKEN_TO_GROUP: dict[str, str] = {
    token: label for label, tokens in _MUSCLE_GROUP_TOKENS for token in tokens
}


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def canonicalize_muscle_group(raw: str | None) -> str | None:
    """Resuelve un string libre (p.ej. ExerciseCatalog.group) al grupo canonico.

    None si no matchea ningun token conocido ("Sin clasificar" en la UI).
    """
    if not raw:
        return None
    words = _strip_accents(raw.lower()).replace("-", " ").split()
    for word in words:
        group = _TOKEN_TO_GROUP.get(word)
        if group:
            return group
    return None
