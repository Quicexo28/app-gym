"""Turn a page's rows into raw per-cell text.

Two passes per page:
  1. A cheap whole-page OCR pass (geometry.detect_row_bands) finds where
     each row sits vertically -- only token *positions* matter there.
  2. Each row is then re-cropped to just its own height and OCR'd again
     (ocr_cache.load_row_tokens). This second pass is the one that
     actually feeds the numeric solver: tesseract reads digits far more
     reliably when it isn't trying to relate a cell to a dozen
     surrounding table rows (see ocr_cache.py's module docstring for a
     concrete before/after example).

Column assignment within a row is purely geometric (x binning against the
fixed template in geometry.py), never ordinal -- so legitimately empty
TCAC cells stay empty instead of shifting every later column left by one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import geometry as geo
from .ocr_cache import Token, load_row_tokens, load_tokens, page_png

_MIN_X_OVERLAP = 0.6
_ROW_Y_PAD = 3


def _tokens_in_box(
    tokens: list[Token], x0: int, x1: int, y0: int, y1: int
) -> list[Token]:
    """Tokens whose vertical center falls in [y0,y1) AND whose horizontal
    span is *mostly* inside [x0,x1). Center-point-only x matching lets a
    wide, low-confidence artifact token that straddles a column boundary
    get claimed by the wrong (neighboring) column merely because its
    midpoint tips over the line; requiring majority overlap fixes that
    without needing to know why the artifact token exists in the first
    place (observed cause: OCR occasionally misreads anti-aliasing noise
    right at a column's vertical gridline as a short, oddly-tall "word").
    """
    hits = []
    for t in tokens:
        cy = t.top + t.height / 2
        if not (y0 <= cy < y1):
            continue
        overlap = max(0, min(t.left + t.width, x1) - max(t.left, x0))
        if overlap / max(t.width, 1) >= _MIN_X_OVERLAP:
            hits.append(t)
    return sorted(hits, key=lambda t: t.left)


def _join(tokens: list[Token]) -> str:
    return " ".join(t.text for t in tokens).strip()


@dataclass
class ProximalRow:
    row_index: int
    code_ocr: str
    nombre_ocr: str
    parte_analizada_ocr: str
    cells: dict[str, str] = field(default_factory=dict)


@dataclass
class MineralRow:
    row_index: int
    code_ocr: str
    edible_pct_raw: str
    cells: dict[str, str] = field(default_factory=dict)


def extract_proximal_page(pdf_page: int) -> list[ProximalRow]:
    page_tokens = load_tokens(pdf_page)
    tok_tuples = [(t.left, t.top, t.width, t.height, t.text) for t in page_tokens]
    bands = geo.detect_row_bands(str(page_png(pdf_page)), tok_tuples)

    x0_all = geo.CODE_COL_PROXIMAL[0]
    x1_all = geo.PROXIMAL_COLUMNS["ash_g"][1]

    rows = []
    for rb in bands:
        box = (x0_all, max(rb.y0 - _ROW_Y_PAD, 0), x1_all, rb.y1 + _ROW_Y_PAD)
        row_tokens = load_row_tokens(pdf_page, f"p{rb.index:02d}", box, psm=6)

        code_toks = _tokens_in_box(row_tokens, *geo.CODE_COL_PROXIMAL, rb.y0, rb.y1)
        nombre_toks = _tokens_in_box(row_tokens, *geo.NOMBRE_COL, rb.y0, rb.y1)
        parte_toks = _tokens_in_box(row_tokens, *geo.PARTE_ANALIZADA_COL, rb.y0, rb.y1)
        cells = {
            key: _join(_tokens_in_box(row_tokens, x0, x1, rb.y0, rb.y1))
            for key, (x0, x1) in geo.PROXIMAL_COLUMNS.items()
        }
        rows.append(
            ProximalRow(
                row_index=rb.index,
                code_ocr=_join(code_toks),
                nombre_ocr=_join(nombre_toks),
                parte_analizada_ocr=_join(parte_toks),
                cells=cells,
            )
        )
    return rows


def extract_mineral_page(pdf_page: int) -> list[MineralRow]:
    page_tokens = load_tokens(pdf_page)
    tok_tuples = [(t.left, t.top, t.width, t.height, t.text) for t in page_tokens]
    bands = geo.detect_row_bands(str(page_png(pdf_page)), tok_tuples)

    x0_all = geo.MINERAL_COLUMNS["calcium_mg"][0]
    x1_all = geo.CODE_COL_MINERAL[1]

    rows = []
    for rb in bands:
        box = (x0_all, max(rb.y0 - _ROW_Y_PAD, 0), x1_all, rb.y1 + _ROW_Y_PAD)
        row_tokens = load_row_tokens(pdf_page, f"m{rb.index:02d}", box, psm=6)

        code_toks = _tokens_in_box(row_tokens, *geo.CODE_COL_MINERAL, rb.y0, rb.y1)
        cells = {
            key: _join(_tokens_in_box(row_tokens, x0, x1, rb.y0, rb.y1))
            for key, (x0, x1) in geo.MINERAL_COLUMNS.items()
        }
        rows.append(
            MineralRow(
                row_index=rb.index,
                code_ocr=_join(code_toks),
                edible_pct_raw=cells.get("edible_portion_pct", ""),
                cells=cells,
            )
        )
    return rows
