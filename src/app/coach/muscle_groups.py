from __future__ import annotations

from coach_ai.training_core import MUSCLE_GROUPS, canonicalize_muscle_group

__all__ = ["MUSCLE_GROUPS", "canonicalize_muscle_group", "validate_priority_muscle_groups"]


def validate_priority_muscle_groups(values: list[str]) -> list[str]:
    """Valida y deduplica una lista de grupos prioritarios contra la taxonomia
    canonica de coach_ai. Lanza ValueError (el endpoint la traduce a 422) si
    algun valor no es un grupo canonico conocido.
    """
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value not in MUSCLE_GROUPS:
            raise ValueError(f"Grupo muscular invalido: {value!r}")
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out
