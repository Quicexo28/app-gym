"""Page layout constants for the TCAC 2018 PDF table.

The PDF (147 pages, image-only, rendered at 300dpi -> 2597x2597px per page)
uses a fixed two-page-per-batch template throughout the whole nutritional
table section (PDF pages 43-108):

  - odd PDF page  = "ANALISIS PROXIMAL" block (Codigo, Nombre, Parte
    Analizada + 9 numeric columns).
  - even PDF page = "MINERALES / VITAMINAS / ACIDOS GRASOS" block (8
    minerals + 7 vitamins + 4 fatty-acid/cholesterol columns + Parte
    Comestible + Codigo, mirrored to the right).

Both pages in a pair list the same foods, in the same top-to-bottom order,
which is how proximal and mineral/vitamin data get joined (see build.py).

Column x-ranges and category page-ranges below were measured directly on
rendered pages (pg-043, pg-045, pg-046, pg-070, pg-108) by overlaying a
pixel-coordinate grid and reading boundaries visually, then cross-checked
against clustering of actual OCR token x-positions. The template is
pixel-identical across all categories (verified on pages spanning the very
first and very last categories in the book).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Page range that holds actual nutrition data (PDF page numbers, 1-indexed,
# matching the pg-NNN.png cache filenames).
# ---------------------------------------------------------------------------
FIRST_DATA_PAGE = 43
LAST_DATA_PAGE = 108

# ---------------------------------------------------------------------------
# Categories, in TOC order. Page numbers are PDF page numbers (printed-page
# + 1, since the PDF has one extra front-matter page relative to the
# printed footer numbering).
# ---------------------------------------------------------------------------
CATEGORIES: list[tuple[str, str, int, int]] = [
    ("A", "Cereales y derivados", 43, 48),
    ("B", "Verduras, hortalizas y derivados", 49, 56),
    ("C", "Frutas y derivados", 57, 62),
    ("D", "Grasas y aceites", 63, 64),
    ("E", "Pescados y mariscos", 65, 68),
    ("F", "Carnes y derivados", 69, 78),
    ("G", "Leche y derivados", 79, 80),
    ("H", "Bebidas (alcoholicas y no alcoholicas)", 81, 82),
    ("J", "Huevos y derivados", 83, 84),
    ("K", "Productos azucarados", 85, 88),
    ("L", "Misceláneos", 89, 90),
    ("N", "Alimentos para regímenes especiales", 91, 92),
    ("P", "Alimentos nativos", 93, 100),
    ("R", "Alimentos manufacturados", 101, 102),
    ("S", "Alimentos preparados", 103, 106),
    ("T", "Leguminosas y derivados", 107, 108),
]


def category_for_page(pdf_page: int) -> tuple[str, str] | None:
    for code, name, start, end in CATEGORIES:
        if start <= pdf_page <= end:
            return code, name
    return None


def block_type(pdf_page: int) -> str:
    """'proximal' on odd PDF pages, 'mineral' on even PDF pages."""
    return "proximal" if pdf_page % 2 == 1 else "mineral"


def proximal_page_for(mineral_page: int) -> int:
    return mineral_page - 1


# ---------------------------------------------------------------------------
# Column x-ranges (pixels, at the 300dpi / 2597x2597 render used throughout
# this pipeline). Left-inclusive, right-exclusive.
# ---------------------------------------------------------------------------

# Shared left-hand identification columns on PROXIMAL pages.
CODE_COL_PROXIMAL = (150, 300)
NOMBRE_COL = (300, 1150)
PARTE_ANALIZADA_COL = (1150, 1440)

# 9 numeric columns of the "ANALISIS PROXIMAL" block.
PROXIMAL_COLUMNS: dict[str, tuple[int, int]] = {
    "moisture_g": (1440, 1559),
    "energy_kcal": (1559, 1655),
    "energy_kj": (1655, 1763),
    "protein_g": (1763, 1875),
    "fat_g": (1875, 1982),
    "carbs_g": (1982, 2076),
    "carbs_available_g": (2076, 2190),
    "fiber_g": (2190, 2288),
    "ash_g": (2288, 2430),
}

# 19 numeric columns + Parte Comestible + Codigo on MINERAL/VITAMIN pages.
MINERAL_COLUMNS: dict[str, tuple[int, int]] = {
    "calcium_mg": (180, 300),
    "iron_mg": (300, 393),
    "sodium_mg": (393, 493),
    "phosphorus_mg": (493, 598),
    # Printed unit label says "(mg)" but magnitudes (single/double digit
    # with 1 decimal) are only plausible as micrograms; TCAC's own header
    # is mislabeled. Stored as iodine_ug without further scaling.
    "iodine_ug": (598, 696),
    "zinc_mg": (696, 797),
    "magnesium_mg": (797, 908),
    "potassium_mg": (908, 1015),
    "thiamin_mg": (1015, 1118),
    "riboflavin_mg": (1118, 1220),
    "niacin_mg": (1220, 1310),
    "folate_ug": (1310, 1400),
    "vitamin_b12_ug": (1400, 1600),
    "vitamin_c_mg": (1600, 1730),
    "vitamin_a_ug": (1730, 1815),
    "sat_fat_g": (1815, 1900),
    "fat_monounsaturated_g": (1900, 1985),
    "fat_polyunsaturated_g": (1985, 2085),
    "cholesterol_mg": (2085, 2190),
    "edible_portion_pct": (2190, 2290),
}
CODE_COL_MINERAL = (2290, 2430)

TABLE_X0 = 150
TABLE_X1 = 2430

# Region excluded from row-content search (footer band: page number tab +
# "Tabla de Composicion de Alimentos Colombianos" caption + decorative
# background watermark near the very bottom of the page).
FOOTER_Y_CUTOFF = 2450

# Sanity ceiling only (guards against runaway synthesis if content_bottom
# detection misfires) -- not a real structural constant. Observed maximum
# is 32 (T category, page 108).
MAX_ROWS_PER_PAGE = 34


@dataclass
class RowBand:
    index: int
    y0: int
    y1: int


def _brightness_bands(
    png_path: str, x0: int = 200, x1: int = 2400, y0: int = 0, y1: int = 2597
) -> list[tuple[int, int, int, int]]:
    """Classify each row of pixels in [x0:x1] into dark header (0), row-tint
    A (1), or row-tint B (2), and return contiguous (start, end, height,
    label) bands. Uses the median color across the slice so sparse text in
    the slice doesn't skew the classification.
    """
    im = np.asarray(Image.open(png_path).convert("RGB")).astype(int)
    strip = im[y0:y1, x0:x1]
    med = np.median(strip, axis=1)
    bright = med.mean(axis=1)

    def cls(b: float) -> int:
        if b < 140:
            return 0
        if b < 210:
            return 1
        return 2

    labels = [cls(b) for b in bright]
    bands: list[tuple[int, int, int, int]] = []
    start = 0
    cur = labels[0]
    for i in range(1, len(labels)):
        if labels[i] != cur:
            bands.append((start + y0, i + y0, i - start, cur))
            start = i
            cur = labels[i]
    bands.append((start + y0, len(labels) + y0, len(labels) - start, cur))
    return bands


def detect_row_bands(png_path: str, tokens: list[tuple[int, int, int, int, str]]) -> list[RowBand]:
    """Detect the y-ranges of each data row on a table page.

    Combines two signals:
      - alternating background-tint bands (reliable for header-bottom
        detection and for measuring the per-page row height), and
      - OCR token positions (reliable for finding exactly how far down the
        last real row of content extends, since the trailing row can share
        its background tint with the blank margin below it and merge into
        one oversized band otherwise).

    ``tokens`` are (left, top, width, height, text) tuples from the page's
    OCR TSV (level-5 rows only), already filtered to non-empty text.
    """
    bands = _brightness_bands(png_path)
    dark_bands = [b for b in bands if b[3] == 0]
    if not dark_bands:
        raise ValueError(f"no header band found in {png_path}")
    header_band = max(dark_bands, key=lambda b: b[2])
    header_bottom = header_band[1]

    row_like = [
        b for b in bands
        if b[0] >= header_bottom
        and b[1] <= FOOTER_Y_CUTOFF
        and b[3] in (1, 2)
        and 40 <= b[2] <= 75
    ]
    if row_like:
        heights = sorted(b[2] for b in row_like)
        row_height = heights[len(heights) // 2]
    else:
        row_height = 57

    content_tokens = [
        t for t in tokens
        if TABLE_X0 <= t[0] <= TABLE_X1 and header_bottom <= t[1] < FOOTER_Y_CUTOFF
    ]
    if not content_tokens:
        return []
    content_bottom = max(t[1] + t[3] for t in content_tokens)

    # Use the *actual* detected band edges for every row they cover -- a
    # fixed grid extrapolated purely from header_bottom + i*row_height
    # drifts against the real boundaries by the time it reaches the last
    # rows of a full 31-row page (row_height is a median, not exact for
    # every row), which was splitting single real rows across two
    # extracted "rows" near the bottom of long pages. Real band edges can
    # go missing anywhere on the page, not just at the very end: whenever
    # one row's background-tint band happens to fail the 40-75px height
    # filter (e.g. it merges with a neighbor because both landed on the
    # same tint), that row's edge disappears from ``row_like`` and leaves
    # a gap several rows wide. Every such gap -- trailing or internal --
    # gets subdivided into row_height-sized pieces instead of being left
    # as one oversized row (which was silently smashing 2+ real rows'
    # cells together).
    raw_edges = [header_bottom] + [b[1] for b in row_like]
    if raw_edges[-1] < content_bottom:
        raw_edges.append(content_bottom)

    edges = [raw_edges[0]]
    for edge in raw_edges[1:]:
        gap = edge - edges[-1]
        if gap > row_height * 1.4:
            n_sub = max(round(gap / row_height), 1)
            step = gap / n_sub
            base = edges[-1]
            for k in range(1, n_sub):
                edges.append(round(base + step * k))
        edges.append(edge)

    n_rows = len(edges) - 1
    n_rows = max(1, min(n_rows, MAX_ROWS_PER_PAGE))

    return [
        RowBand(index=i, y0=edges[i], y1=edges[i + 1])
        for i in range(n_rows)
    ]
