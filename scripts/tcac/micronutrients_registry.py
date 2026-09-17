"""Read-only lookup of the canonical micronutrient keys.

Parses src/app/nutrition/micronutrients.py by regex instead of importing
it, so this pipeline has no dependency on the app's runtime (FastAPI/DB
config etc.) -- it only needs the literal key strings, which must match
exactly for the seeder to map TCAC data onto MICRONUTRIENTS_BY_KEY.
"""

from __future__ import annotations

import re
from pathlib import Path
from functools import lru_cache

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_FILE = REPO_ROOT / "src" / "app" / "nutrition" / "micronutrients.py"

_KEY_RE = re.compile(r'MicronutrientDefinition\(\s*"([a-z0-9_]+)"')


@lru_cache(maxsize=1)
def canonical_keys() -> frozenset[str]:
    text = SOURCE_FILE.read_text(encoding="utf-8")
    keys = _KEY_RE.findall(text)
    if not keys:
        raise RuntimeError(f"no MicronutrientDefinition entries found in {SOURCE_FILE}")
    return frozenset(keys)
