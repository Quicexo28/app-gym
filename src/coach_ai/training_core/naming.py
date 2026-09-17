from __future__ import annotations

import re


def normalize_exercise_name(name: str) -> str:
    """Normaliza un nombre de ejercicio para matchear entre sesiones/rutinas.

    No hay id de catalogo estable que viaje hasta la rutina/sesion guardada
    (todo es texto libre) - este es el unico criterio de "mismo ejercicio"
    disponible hoy en todo el pipeline (reportes, indice de rutinas, insights
    por musculo).
    """
    return re.sub(r"\s+", " ", (name or "").strip().lower())
