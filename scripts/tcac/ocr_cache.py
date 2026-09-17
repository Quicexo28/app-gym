"""Resumable, disk-cached tesseract OCR over the rendered TCAC pages.

Two OCR strategies are used:

  - Whole-page OCR (``load_tokens``), psm 6, cached to cache/ocr/pg-NNN.tsv.
    Used only to find where each table row sits vertically (geometry.py) --
    for that purpose we just need token *positions*, not perfectly read
    digits.
  - Per-row OCR (``load_row_tokens``), cropped to a single row's height and
    re-run through tesseract fresh. This is the one that actually feeds
    the numeric solver, because whole-page OCR of this table is
    measurably worse at reading digits than row-cropped OCR: on a spot
    check (TCAC code A021, kcal column), whole-page psm 6 reads "390" as
    "300", while the same pixels cropped to just that row's height and
    re-OCR'd read "390" correctly. Row height is a single physical
    text line, so tesseract's own layout analysis stops trying to relate
    it to neighboring rows -- fewer neighboring rows for the LSTM model
    to (mis)use as context means fewer digit substitutions. Both the
    per-row crop and its OCR result are cached to disk (cache/rows/,
    cache/ocr_rows/), keyed by page + row key, so a large re-run only
    redoes rows that are missing from the cache.
"""

from __future__ import annotations

import csv
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PAGES_DIR = HERE / "cache" / "pages"
OCR_DIR = HERE / "cache" / "ocr"
ROWS_DIR = HERE / "cache" / "rows"
OCR_ROWS_DIR = HERE / "cache" / "ocr_rows"


@dataclass(frozen=True, slots=True)
class Token:
    left: int
    top: int
    width: int
    height: int
    conf: float
    text: str


def page_png(pdf_page: int) -> Path:
    return PAGES_DIR / f"pg-{pdf_page:03d}.png"


def ocr_tsv_path(pdf_page: int) -> Path:
    return OCR_DIR / f"pg-{pdf_page:03d}.tsv"


def _run_tesseract_tsv(png_path: Path, out_base: Path, psm: int) -> Path:
    out_base.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["tesseract", str(png_path), str(out_base), "--psm", str(psm), "tsv"],
        check=True,
        capture_output=True,
    )
    return out_base.with_suffix(".tsv")


def _parse_tsv(tsv_path: Path, x_offset: int = 0, y_offset: int = 0) -> list[Token]:
    tokens: list[Token] = []
    with tsv_path.open(newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        next(reader, None)
        for row in reader:
            # Rare tesseract TSV quirk: a degenerate (near-zero-area) box
            # can emit a "word" whose text is itself several raw TSV lines
            # glued together with embedded tabs/newlines. Guard against it
            # rather than let it corrupt row/column parsing downstream.
            if len(row) != 12 or row[0] != "5":
                continue
            text = row[11]
            if not text.strip() or "\t" in text or "\n" in text:
                continue
            try:
                width, height = int(row[8]), int(row[9])
            except ValueError:
                continue
            if width < 3 or height < 3:
                continue
            try:
                conf = float(row[10])
            except ValueError:
                conf = -1.0
            tokens.append(
                Token(
                    left=int(row[6]) + x_offset,
                    top=int(row[7]) + y_offset,
                    width=width,
                    height=height,
                    conf=conf,
                    text=text,
                )
            )
    return tokens


def ensure_ocr(pdf_page: int) -> Path:
    """Whole-page OCR, cached. Used only for row-boundary detection."""
    tsv_path = ocr_tsv_path(pdf_page)
    if tsv_path.exists() and tsv_path.stat().st_size > 0:
        return tsv_path
    png_path = page_png(pdf_page)
    if not png_path.exists():
        raise FileNotFoundError(f"missing rendered page: {png_path}")
    return _run_tesseract_tsv(png_path, tsv_path.with_suffix(""), psm=6)


def load_tokens(pdf_page: int) -> list[Token]:
    return _parse_tsv(ensure_ocr(pdf_page))


def ensure_row_ocr(
    pdf_page: int,
    row_key: str,
    box: tuple[int, int, int, int],
    psm: int = 6,
) -> tuple[Path, int, int]:
    """Crop ``box`` (x0, y0, x1, y1) out of the page image and OCR just
    that strip. Both the crop and the OCR result are cached to disk so a
    resumed run skips rows already processed. Returns (tsv_path, x0, y0)
    so callers can translate token coordinates back to page space.
    """
    x0, y0, x1, y1 = box
    row_png = ROWS_DIR / f"pg-{pdf_page:03d}-{row_key}.png"
    row_tsv = OCR_ROWS_DIR / f"pg-{pdf_page:03d}-{row_key}.tsv"

    if not row_png.exists():
        row_png.parent.mkdir(parents=True, exist_ok=True)
        page_im = Image.open(page_png(pdf_page))
        page_im.crop((x0, y0, x1, y1)).save(row_png)

    if not (row_tsv.exists() and row_tsv.stat().st_size > 0):
        _run_tesseract_tsv(row_png, row_tsv.with_suffix(""), psm=psm)

    return row_tsv, x0, y0


def load_row_tokens(
    pdf_page: int,
    row_key: str,
    box: tuple[int, int, int, int],
    psm: int = 6,
) -> list[Token]:
    tsv_path, x0, y0 = ensure_row_ocr(pdf_page, row_key, box, psm=psm)
    return _parse_tsv(tsv_path, x_offset=x0, y_offset=y0)
