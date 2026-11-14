"""Normalización de texto compartida por los endpoints."""

from __future__ import annotations


def clean_text(value: str | None, *, max_len: int | None = None) -> str | None:
    """Colapsa espacios; devuelve `None` si queda vacío. Recorta a `max_len` si se indica."""
    if value is None:
        return None
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        return None
    if max_len is not None and len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip()
    return cleaned or None
