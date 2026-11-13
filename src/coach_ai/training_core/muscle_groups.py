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
    ("Dorsales", ("dorsal", "dorsales")),
    # "espalda" suelta (historial anterior a la separacion) cae aqui; ver _PHRASES.
    ("Espalda Alta", ("espalda", "romboide", "romboides")),
    ("Trapecio", ("trapecio", "trapecios")),
    ("Lumbares", ("lumbar", "lumbares")),
    ("Abdomen", ("abdomen", "abdominales", "abdominal", "core")),
    ("Gluteos", ("gluteo", "gluteos")),
    ("Abductores", ("abductor", "abductores")),
    ("Aductores", ("aductor", "aductores")),
    ("Cuadriceps", ("cuadricep", "cuadriceps")),
    ("Femorales", ("femoral", "femorales", "isquiotibial", "isquiotibiales")),
    ("Pantorrillas", ("pantorrilla", "pantorrillas", "gemelo", "gemelos")),
]

MUSCLE_GROUPS: list[str] = [label for label, _tokens in _MUSCLE_GROUP_TOKENS]

# Frases de varias palabras: se miran antes que las palabras sueltas.
_PHRASES: dict[str, str] = {
    "espalda alta": "Espalda Alta",
    "espalda baja": "Lumbares",
}

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
    text = " ".join(_strip_accents(raw.lower()).replace("-", " ").split())
    for phrase, group in _PHRASES.items():
        if phrase in text:
            return group
    for word in text.split():
        group = _TOKEN_TO_GROUP.get(word)
        if group:
            return group
    return None


# Peso con el que cuenta un musculo secundario respecto del principal (1.0).
SECONDARY_WEIGHT = 0.5


def muscle_shares(
    primary_raw: str | None, extras: list[dict] | None = None
) -> dict[str, float]:
    """Reparte un ejercicio entre los musculos que trabaja: {grupo canonico: peso}.

    El grupo principal pesa 1.0. Cada extra es {"group": str, "weight": float}:
    1.0 = segundo musculo principal, 0.5 (SECONDARY_WEIGHT) = secundario.
    Si un grupo aparece dos veces gana el peso mayor. Extras invalidos se ignoran.
    """
    shares: dict[str, float] = {}
    primary = canonicalize_muscle_group(primary_raw)
    if primary:
        shares[primary] = 1.0
    for extra in extras or []:
        if not isinstance(extra, dict):
            continue
        group = canonicalize_muscle_group(extra.get("group"))
        try:
            weight = float(extra.get("weight", SECONDARY_WEIGHT))
        except (TypeError, ValueError):
            continue
        if group is None or weight <= 0:
            continue
        shares[group] = max(shares.get(group, 0.0), min(weight, 1.0))
    return shares
