"""Cliente de Open Food Facts (unica fuente externa de alimentos).

Reglas duras verificadas en vivo contra la API real:
- `GET /api/v2/product/{barcode}.json` responde HTTP 200 incluso cuando el
  producto no existe; en ese caso trae `{"status": 0, "status_verbose":
  "product not found"}`. `status == 1` es la unica senal de exito.
- El User-Agent es obligatorio por politica de OFF.
- Cualquier fallo de red (timeout, DNS, 5xx, JSON invalido) degrada con
  elegancia: nunca se propaga una excepcion al llamador, se devuelve None o
  lista vacia segun el caso.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

OFF_BASE_URL = "https://world.openfoodfacts.org"
USER_AGENT = "Alzo/1.0 (santiagoquicenoqp@gmail.com)"
REQUEST_TIMEOUT_SECONDS = 8.0

_PRODUCT_FIELDS = "code,product_name,brands,quantity,countries_tags,nutriments"


@dataclass(frozen=True, slots=True)
class OffProduct:
    """Producto normalizado de OFF, aun sin mapear a nuestras columnas."""

    barcode: str
    name: str
    brand: str | None
    quantity_label: str | None
    nutriments: dict[str, Any]


def _headers() -> dict[str, str]:
    return {"User-Agent": USER_AGENT}


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _to_off_product(raw: dict[str, Any]) -> OffProduct | None:
    name = _clean(raw.get("product_name"))
    barcode = _clean(raw.get("code"))
    if not name or not barcode:
        return None
    return OffProduct(
        barcode=barcode,
        name=name,
        brand=_clean(raw.get("brands")),
        quantity_label=_clean(raw.get("quantity")),
        nutriments=raw.get("nutriments") or {},
    )


def fetch_product_by_barcode(barcode: str) -> OffProduct | None:
    """Busca un producto por codigo de barras.

    Devuelve None si no existe (`status != 1`) o si hay cualquier problema de
    red/parseo. Nunca lanza.
    """
    clean_barcode = (barcode or "").strip()
    if not clean_barcode:
        return None

    url = f"{OFF_BASE_URL}/api/v2/product/{clean_barcode}.json"
    try:
        response = httpx.get(
            url,
            params={"fields": _PRODUCT_FIELDS},
            headers=_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:  # noqa: BLE001 - degradacion elegante deliberada, ver docstring del modulo
        logger.warning("off_client: fallo consultando barcode=%s", clean_barcode, exc_info=True)
        return None

    if not isinstance(payload, dict) or payload.get("status") != 1:
        return None

    product = payload.get("product")
    if not isinstance(product, dict):
        return None

    return _to_off_product(product)


def search_products(query: str, *, page_size: int = 20) -> list[OffProduct]:
    """Busqueda de texto libre en OFF. Nunca lanza; degrada a lista vacia."""
    clean_query = (query or "").strip()
    if not clean_query:
        return []

    url = f"{OFF_BASE_URL}/api/v2/search"
    try:
        response = httpx.get(
            url,
            params={
                "search_terms": clean_query,
                "fields": _PRODUCT_FIELDS,
                "page_size": max(1, min(page_size, 50)),
                "json": "true",
            },
            headers=_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:  # noqa: BLE001 - degradacion elegante deliberada, ver docstring del modulo
        logger.warning("off_client: fallo buscando query=%r", clean_query, exc_info=True)
        return []

    if not isinstance(payload, dict):
        return []

    raw_products = payload.get("products")
    if not isinstance(raw_products, list):
        return []

    results: list[OffProduct] = []
    for raw in raw_products:
        if not isinstance(raw, dict):
            continue
        product = _to_off_product(raw)
        if product is not None:
            results.append(product)
    return results
