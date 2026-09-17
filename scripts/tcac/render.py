"""Render the TCAC 2018 PDF to per-page PNGs at 300dpi (resumable).

The PDF is 100% scanned images (pdftotext yields ~147 bytes total across
the whole document), so every downstream step works off these renders.
Safe to re-run: pages that already exist in cache/pages/ are skipped.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAGES_DIR = HERE / "cache" / "pages"

DEFAULT_PDF_CANDIDATES = [
    Path(
        "/tmp/claude-1000/-home-santiago2-app-gym/"
        "44902202-4438-4454-8991-49e8fc108f31/scratchpad/tcac_web.pdf"
    ),
]
PDF_URL = "https://www.icbf.gov.co/sites/default/files/tcac_web.pdf"
TOTAL_PAGES = 147
DPI = 300


def _find_pdf() -> Path:
    for candidate in DEFAULT_PDF_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "tcac_web.pdf not found in known scratch locations. Download it "
        f"first, e.g.: curl -o /tmp/tcac_web.pdf {PDF_URL}"
    )


def render_all(pdf_path: Path | None = None) -> int:
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    missing = [
        p for p in range(1, TOTAL_PAGES + 1)
        if not (PAGES_DIR / f"pg-{p:03d}.png").exists()
    ]
    if not missing:
        return 0

    pdf_path = pdf_path or _find_pdf()
    # pdftoppm renders contiguous ranges; since the cache is usually either
    # empty or fully populated, just render the full missing span in one
    # shot when it's contiguous, otherwise fall back to per-page calls.
    contiguous = missing == list(range(missing[0], missing[-1] + 1))
    if contiguous:
        subprocess.run(
            [
                "pdftoppm", "-r", str(DPI), "-png",
                "-f", str(missing[0]), "-l", str(missing[-1]),
                str(pdf_path), str(PAGES_DIR / "pg"),
            ],
            check=True,
        )
        # pdftoppm pads with the width needed for TOTAL_PAGES; normalize to
        # our fixed pg-NNN.png (3-digit) naming when it differs.
        for p in range(missing[0], missing[-1] + 1):
            produced = list(PAGES_DIR.glob(f"pg-*{p}.png"))
            target = PAGES_DIR / f"pg-{p:03d}.png"
            if not target.exists():
                for cand in produced:
                    if cand.stem.endswith(f"-{p}") or cand.stem.endswith(f"-{p:02d}"):
                        cand.rename(target)
                        break
    else:
        for p in missing:
            subprocess.run(
                [
                    "pdftoppm", "-r", str(DPI), "-png",
                    "-f", str(p), "-l", str(p),
                    "-singlefile",
                    str(pdf_path), str(PAGES_DIR / f"pg-{p:03d}"),
                ],
                check=True,
            )
    return len(missing)


if __name__ == "__main__":
    rendered = render_all()
    print(f"rendered {rendered} new page(s); cache holds "
          f"{len(list(PAGES_DIR.glob('pg-*.png')))} page(s)", file=sys.stderr)
