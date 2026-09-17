from __future__ import annotations

import io
import os

import pytest
from PIL import Image

from app.nutrition.media import (
    MAX_EDGE_PX,
    MAX_UPLOAD_BYTES,
    InvalidImageError,
    validate_and_reencode,
)


def _make_image_bytes(
    size: tuple[int, int], fmt: str, color: tuple[int, int, int] = (200, 30, 30)
) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def test_valid_jpeg_is_accepted_and_reencoded() -> None:
    data = _make_image_bytes((400, 300), "JPEG")

    result = validate_and_reencode(data, "image/jpeg")

    with Image.open(io.BytesIO(result)) as out:
        assert out.format == "JPEG"
        assert out.size == (400, 300)


def test_valid_png_is_converted_to_jpeg() -> None:
    data = _make_image_bytes((200, 200), "PNG")

    result = validate_and_reencode(data, "image/png")

    with Image.open(io.BytesIO(result)) as out:
        assert out.format == "JPEG"


def test_valid_webp_is_converted_to_jpeg() -> None:
    data = _make_image_bytes((150, 150), "WEBP")

    result = validate_and_reencode(data, "image/webp")

    with Image.open(io.BytesIO(result)) as out:
        assert out.format == "JPEG"


def test_large_image_is_downscaled_to_max_edge() -> None:
    data = _make_image_bytes((4000, 2000), "JPEG")

    result = validate_and_reencode(data, "image/jpeg")

    with Image.open(io.BytesIO(result)) as out:
        assert max(out.size) <= MAX_EDGE_PX
        # Se preserva la proporcion 2:1 dentro del redondeo del thumbnail.
        assert out.size[0] == MAX_EDGE_PX
        assert abs(out.size[0] / out.size[1] - 2.0) < 0.02


def test_small_image_is_not_upscaled() -> None:
    data = _make_image_bytes((80, 60), "JPEG")

    result = validate_and_reencode(data, "image/jpeg")

    with Image.open(io.BytesIO(result)) as out:
        assert out.size == (80, 60)


def test_empty_file_is_rejected() -> None:
    with pytest.raises(InvalidImageError):
        validate_and_reencode(b"", "image/jpeg")


def test_oversized_file_is_rejected() -> None:
    oversized = _make_image_bytes((10, 10), "JPEG") + (b"0" * (MAX_UPLOAD_BYTES + 1))

    with pytest.raises(InvalidImageError):
        validate_and_reencode(oversized, "image/jpeg")


def test_unsupported_content_type_is_rejected() -> None:
    data = _make_image_bytes((100, 100), "JPEG")

    with pytest.raises(InvalidImageError):
        validate_and_reencode(data, "application/pdf")


def test_missing_content_type_is_rejected() -> None:
    data = _make_image_bytes((100, 100), "JPEG")

    with pytest.raises(InvalidImageError):
        validate_and_reencode(data, None)


def test_non_image_bytes_disguised_as_image_are_rejected_by_magic_bytes() -> None:
    """Archivo poliglota: header de un ZIP/exe, content-type falseado a image/jpeg."""
    fake = b"PK\x03\x04" + os.urandom(500)

    with pytest.raises(InvalidImageError):
        validate_and_reencode(fake, "image/jpeg")


def test_corrupted_image_with_valid_magic_bytes_is_rejected() -> None:
    """Bytes que arrancan como JPEG valido pero no son un stream completo."""
    corrupted = b"\xff\xd8\xff" + os.urandom(200)

    with pytest.raises(InvalidImageError):
        validate_and_reencode(corrupted, "image/jpeg")


def test_truncated_png_is_rejected() -> None:
    full_png = _make_image_bytes((100, 100), "PNG")
    truncated = full_png[: len(full_png) // 2]

    with pytest.raises(InvalidImageError):
        validate_and_reencode(truncated, "image/png")
