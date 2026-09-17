"""Validacion y reencodificado de fotos de empaques de alimentos.

Reglas de seguridad (sección 5/7 de docs/modulo-dieta.md):
- Se valida content-type Y magic bytes (nunca se confia solo en el header).
- Tope de 6 MB en el archivo recibido.
- Se reencodifica SIEMPRE con Pillow a JPEG, borde maximo 1600 px. Esto
  descarta EXIF (privacidad: GPS en fotos de empaque) y neutraliza archivos
  poliglotas (un archivo que es a la vez imagen valida y, por ejemplo, un
  script/zip).
- La ruta en disco se arma en `app.api.v1.endpoints.diet` a partir de un
  UUID de producto y un `PhotoKind` de enum controlado — nunca de un nombre
  de archivo ni de texto libre proveniente del cliente.
"""

from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_BYTES = 6 * 1024 * 1024
MAX_EDGE_PX = 1600
JPEG_QUALITY = 88

ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})


class InvalidImageError(ValueError):
    """La imagen recibida no paso las validaciones de tamano/formato/integridad."""


def _sniff_image_format(data: bytes) -> str | None:
    """Detecta el formato real por magic bytes, ignorando lo que diga el header."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def validate_and_reencode(data: bytes, content_type: str | None) -> bytes:
    """Valida tamano/content-type/magic-bytes y devuelve JPEG reencodificado.

    Lanza `InvalidImageError` con un mensaje apto para el usuario si algo no
    cumple. Nunca escribe en disco: solo transforma bytes en memoria.
    """
    if not data:
        raise InvalidImageError("El archivo esta vacio.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidImageError("El archivo supera el limite de 6 MB.")
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise InvalidImageError("Tipo de archivo no soportado.")
    if _sniff_image_format(data) is None:
        raise InvalidImageError("El contenido del archivo no coincide con una imagen soportada.")

    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
    except (UnidentifiedImageError, OSError, ValueError) as err:
        raise InvalidImageError("No se pudo leer la imagen.") from err

    try:
        with Image.open(io.BytesIO(data)) as image:
            rgb_image = image.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as err:
        raise InvalidImageError("No se pudo procesar la imagen.") from err

    rgb_image.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX), Image.LANCZOS)

    buffer = io.BytesIO()
    rgb_image.save(buffer, format="JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue()
