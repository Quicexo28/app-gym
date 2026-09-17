"""Orchestrates the full TCAC 2018 ETL: render -> OCR -> extract -> solve ->
gate -> data/tcac_2018.json.

Run from the repo root with:

    .venv-linux/bin/python -m scripts.tcac.build

Safe to re-run: rendering and OCR are cached to disk (scripts/tcac/cache/)
and skip work that's already done, so an interrupted run just resumes.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

from . import geometry as geo
from .extract import MineralRow, ProximalRow, extract_mineral_page, extract_proximal_page
from .micronutrients_registry import canonical_keys
from .solve import DECIMALS, pick_in_range, reconstruct, solve_proximal_row

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = REPO_ROOT / "data" / "tcac_2018.json"
CACHE_DIR = Path(__file__).resolve().parent / "cache"
AUDIT_PATH = CACHE_DIR / "rejected_rows.json"
STATS_PATH = CACHE_DIR / "build_stats.json"
OVERRIDES_PATH = CACHE_DIR / "vision_overrides.json"

MICRO_KEYS_IN_MINERAL_BLOCK = [
    "calcium_mg", "iron_mg", "phosphorus_mg", "iodine_ug", "zinc_mg",
    "magnesium_mg", "potassium_mg", "thiamin_mg", "riboflavin_mg",
    "niacin_mg", "folate_ug", "vitamin_b12_ug", "vitamin_c_mg", "vitamin_a_ug",
]
TOP_LEVEL_KEYS_IN_MINERAL_BLOCK = [
    "sodium_mg", "sat_fat_g", "fat_monounsaturated_g",
    "fat_polyunsaturated_g", "cholesterol_mg",
]

_NAME_CLEAN_RE = re.compile(r"[^A-Za-zÀ-ÿ0-9 ,.()/%\-]")


def clean_text(raw: str) -> str | None:
    text = raw.strip()
    if not text:
        return None
    text = _NAME_CLEAN_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip(" ,.-")
    return text or None


# ---------------------------------------------------------------------------
# Name post-processing: tesseract has no Spanish language pack installed
# (only eng+osd), so it reliably reads the letters of a word but drops
# diacritics (accents, tildes) entirely -- "maíz" -> "maiz", "Almidón" ->
# "Almidon". This is a dictionary of whole-word corrections for the most
# frequent offenders in the TCAC vocabulary (measured by scanning every
# extracted row's OCR'd name). It's intentionally conservative: only exact,
# common, unambiguous Spanish nutrition/food words go in here -- it does not
# attempt to fix garbled/nonsense OCR (that needs the vision fallback, see
# docs/modulo-dieta.md sec 8.2 and this module's `apply_vision_overrides`).
# ---------------------------------------------------------------------------
_ACCENT_FIXES: dict[str, str] = {
    "maiz": "maíz",
    "platano": "plátano",
    "cascara": "cáscara",
    "azucar": "azúcar",
    "aziicar": "azúcar",
    "azlcar": "azúcar",
    "almidon": "almidón",
    "higado": "hígado",
    "homeado": "horneado",
    "homeada": "horneada",
    "cruds": "cruda",
    "nectar": "néctar",
    "limon": "limón",
    "cafe": "café",
    "camaron": "camarón",
    "salmon": "salmón",
    "atun": "atún",
    "avicola": "avícola",
    "carnicos": "cárnicos",
    "jamon": "jamón",
    "salchichon": "salchichón",
    "guanabana": "guanábana",
    "acido": "ácido",
    "acidos": "ácidos",
    "esparrago": "espárrago",
    "espdrrago": "espárrago",
    "harton": "hartón",
    "sesamo": "sésamo",
    "ajonjoli": "ajonjolí",
    "algodon": "algodón",
    "melon": "melón",
    "pina": "piña",
    "maracuya": "maracuyá",
    "mani": "maní",
    "anon": "anón",
    "arbol": "árbol",
    "region": "región",
    "azucares": "azúcares",
    "polio": "pollo",
    "comin": "común",
    "panela": "panela",
    "cocacion": "cocción",
    "coccion": "cocción",
    "nutricion": "nutrición",
    "vitaminico": "vitamínico",
    "proteico": "proteico",
    "energetico": "energético",
    "organico": "orgánico",
    "rapida": "rápida",
    "rapido": "rápido",
}
_WORD_RE = re.compile(r"[A-Za-zÀ-ÿ]+")


def fix_accents(name: str) -> str:
    def repl(match: re.Match[str]) -> str:
        word = match.group(0)
        fixed = _ACCENT_FIXES.get(word.lower())
        if fixed is None:
            return word
        if word.isupper():
            return fixed.upper()
        if word[0].isupper():
            return fixed[0].upper() + fixed[1:]
        return fixed

    return _WORD_RE.sub(repl, name)


# ---------------------------------------------------------------------------
# Row filtering: a "row" detected by geometry.detect_row_bands can be a
# spurious band with zero real content (no OCR'd name, no OCR'd digits in
# any column) -- e.g. a stray gap in the alternating background tint that
# got sliced into its own band. Every such phantom row was, until now,
# still being assigned a codigo and burning a counter slot, which shifts
# the codigo of every real row after it in the same category. Rows are
# only dropped here when they carry *no* evidence at all; a row with a
# garbled/empty name but real numeric cells (OCR failed on the name only)
# is a real food and is kept -- it's flagged via the placeholder name for
# a later vision-assisted fix, not silently renumbered away.
# ---------------------------------------------------------------------------


def _proximal_has_content(row: ProximalRow) -> bool:
    return bool(clean_text(row.nombre_ocr)) or any(v.strip() for v in row.cells.values())


def _mineral_has_content(row: MineralRow) -> bool:
    return bool(row.code_ocr.strip()) or any(v.strip() for v in row.cells.values())


# ---------------------------------------------------------------------------
# Mineral/vitamin <-> proximal join. The TCAC prints the same food list
# twice per category page-pair (proximal analysis on the odd page, then
# minerals/vitamins on the following even page), and the two OCR passes
# independently detect row bands -- they don't always agree on the row
# count (extra/missing spurious bands on one side), so joining by row
# *position* silently misaligns every row after the first discrepancy.
# Instead this parses each mineral row's own OCR'd Código and matches it
# to the codigo already assigned on the proximal side; only rows whose
# code can't be confidently parsed fall back to positional matching
# against the leftover (still-unmatched) rows, in order.
# ---------------------------------------------------------------------------
_CODE_LETTER_TO_DIGIT = str.maketrans(
    {"O": "0", "D": "0", "Q": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2", "G": "6"}
)
_CODE_STRIP_RE = re.compile(r"[^A-Z0-9]")


def _parse_code_num(raw: str, cat_code: str) -> int | None:
    s = _CODE_STRIP_RE.sub("", raw.upper())
    idx = s.find(cat_code)
    if idx == -1:
        return None
    tail = s[idx + 1:].translate(_CODE_LETTER_TO_DIGIT)
    digits = re.sub(r"[^0-9]", "", tail)
    if not digits:
        return None
    digits = digits[-3:]
    try:
        return int(digits)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Codigo assignment: a plain running counter drifts silently whenever row
# detection over- or under-counts *within* a category (e.g. a food name
# that wraps to two lines occasionally gets carved into two row-bands by
# geometry.detect_row_bands, and the stray continuation band still has
# just enough OCR noise in it to pass `_proximal_has_content`). When that
# happens every codigo after the drift point is off by a constant amount
# -- the nutrient data is still internally valid and gate-checked, but the
# label would point at the wrong food in the printed book (found by
# spot-checking: a counter-only run assigned "B071" to a garbled row that
# the row's own OCR'd Código plainly reads as "B069"). Since ProximalRow
# already carries its own OCR'd `code_ocr`, every row that reads clean and
# plausible (within a small window of the running counter) resyncs the
# counter instead of just trusting the count of rows seen so far.
# ---------------------------------------------------------------------------
_CODE_RESYNC_WINDOW = 6


def assign_codigos(cat_code: str, rows: list[ProximalRow], counter: int) -> tuple[list[str], int]:
    codigos: list[str] = []
    last_assigned = counter - 1  # highest number assigned so far (0 on the first call)
    for row in rows:
        parsed = _parse_code_num(row.code_ocr, cat_code)
        if parsed is not None and abs(parsed - counter) <= _CODE_RESYNC_WINDOW:
            counter = parsed
        # A resync can occasionally land on (or behind) the number just
        # assigned to the previous row -- e.g. a name that wraps to two
        # lines gets read as two row-bands, the first consumes a number
        # via the plain counter, and the second's own clean OCR'd code
        # resyncs backward onto that same number. Codigos must stay
        # strictly increasing within a category, so this is the fallback
        # when a resync would otherwise produce a duplicate.
        if counter <= last_assigned:
            counter = last_assigned + 1
        codigos.append(f"{cat_code}{counter:03d}")
        last_assigned = counter
        counter += 1
    return codigos, counter


def join_mineral_rows(
    cat_code: str, page_codigos: list[str], mrows: list[MineralRow]
) -> dict[str, MineralRow]:
    mrows = [m for m in mrows if _mineral_has_content(m)]
    if not page_codigos or not mrows:
        return {}
    expected_nums = [int(c[len(cat_code):]) for c in page_codigos]
    lo, hi = min(expected_nums), max(expected_nums)

    by_num: dict[int, MineralRow] = {}
    unmatched: list[MineralRow] = []
    for m in mrows:
        num = _parse_code_num(m.code_ocr, cat_code)
        if num is not None and lo <= num <= hi and num not in by_num:
            by_num[num] = m
        else:
            unmatched.append(m)

    result: dict[str, MineralRow] = {}
    leftover_codigos: list[str] = []
    for codigo, num in zip(page_codigos, expected_nums):
        if num in by_num:
            result[codigo] = by_num[num]
        else:
            leftover_codigos.append(codigo)
    # Positional fallback, in order, only for what neither side could
    # confidently match by code.
    for codigo, m in zip(leftover_codigos, unmatched):
        result[codigo] = m
    return result


# ---------------------------------------------------------------------------
# "No carbs_available column" reinterpretation. Measured directly off the
# rendered pages (pixel positions of load_row_tokens output, cross-checked
# on category F/carnes, D/grasas, G/leche, J/huevos, E/pescados): for
# these animal-origin and pure-fat food groups, TCAC's printed table has
# no CARBOHIDRATOS DISPONIBLES sub-column at all (it isn't a meaningful
# distinction for a ~0%-carb food) -- moisture, fiber and ash sit exactly
# where geometry.PROXIMAL_COLUMNS expects them, but energy_kcal through
# carbs_g are each one physical column narrower than the 9-column
# template assumes, so their real values land one slot to the right:
# energy_kcal's box is empty, and what's read as energy_kj/protein_g/
# fat_g/carbs_g/carbs_available_g is really kcal/kj/protein/fat/carbs.
# This reinterpretation is only ever tried as a fallback (see
# `solve_row_with_fallback`) when the normal reading is empty in
# energy_kcal but has something in energy_kj, and only kept when it's the
# one that actually satisfies the gates -- so a row that's genuinely a
# normal 9-column layout with an incidentally-blank kcal cell just keeps
# failing gate on both readings and stays rejected, rather than being
# forced into a wrong shape.
# ---------------------------------------------------------------------------


def _shift_missing_carbs_available(cells: dict[str, str]) -> dict[str, str]:
    return {
        "moisture_g": cells.get("moisture_g", ""),
        "energy_kcal": cells.get("energy_kj", ""),
        "energy_kj": cells.get("protein_g", ""),
        "protein_g": cells.get("fat_g", ""),
        "fat_g": cells.get("carbs_g", ""),
        "carbs_g": cells.get("carbs_available_g", ""),
        "carbs_available_g": "",
        "fiber_g": cells.get("fiber_g", ""),
        "ash_g": cells.get("ash_g", ""),
    }


def solve_row_with_fallback(cells: dict[str, str]):
    """Solve a proximal row, falling back to the no-carbs_available
    reinterpretation only when the normal reading has nothing in
    energy_kcal (its telltale symptom) and only when that reinterpretation
    is the one that actually passes the gates."""
    normal = solve_proximal_row(cells)
    if normal.passes_gate:
        return normal, False
    if cells.get("energy_kcal", "").strip() or not cells.get("energy_kj", "").strip():
        return normal, False
    shifted = solve_proximal_row(_shift_missing_carbs_available(cells))
    if shifted.passes_gate:
        return shifted, True
    return normal, False


def solve_mineral_values(cells: dict[str, str]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for key in geo.MINERAL_COLUMNS:
        raw = cells.get(key, "")
        _, candidates = reconstruct(raw, DECIMALS[key])
        out[key] = pick_in_range(candidates, key)
    return out


# ---------------------------------------------------------------------------
# Vision overrides: for rows where OCR + the decimal solver can't produce a
# reading that satisfies the gates (or where the name OCR is unreadable),
# scripts/tcac/cache/vision_overrides.json records values transcribed
# directly off the rendered row crop (scripts/tcac/cache/rows/pg-*.png) by
# reading the image. This is the pipeline's documented last-resort step
# (docs/modulo-dieta.md sec 8.4: "escala a revision por vision sobre el
# recorte de esa fila"). Keyed by codigo; each entry may set "nombre"
# and/or any of the 9 proximal `nutrientes` fields. Overridden values still
# have to pass the same 2 gates as everything else -- this is corrected
# input to the solver's invariant check, not a bypass of it.
# ---------------------------------------------------------------------------


def load_vision_overrides() -> dict[str, dict]:
    if not OVERRIDES_PATH.exists():
        return {}
    with OVERRIDES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def run() -> dict[str, object]:
    canon = canonical_keys()
    missing_canon = [k for k in MICRO_KEYS_IN_MINERAL_BLOCK if k not in canon]
    if missing_canon:
        raise RuntimeError(
            f"micronutrient keys not found in canonical registry: {missing_canon}"
        )

    overrides = load_vision_overrides()
    overrides_applied: set[str] = set()

    foods: list[dict] = []
    rejected: list[dict] = []
    stats: Counter[str] = Counter()
    invariant_failures: Counter[str] = Counter()
    page_stats: list[dict] = []

    for cat_code, cat_name, start, end in geo.CATEGORIES:
        counter = 1
        page = start
        while page <= end:
            if geo.block_type(page) != "proximal":
                page += 1
                continue
            mineral_page = page + 1
            all_proximal_rows = extract_proximal_page(page)
            proximal_rows = [r for r in all_proximal_rows if _proximal_has_content(r)]
            phantom_rows = len(all_proximal_rows) - len(proximal_rows)

            page_codigos, counter = assign_codigos(cat_code, proximal_rows, counter)
            mrows = extract_mineral_page(mineral_page) if mineral_page <= end else []
            mineral_by_codigo = join_mineral_rows(cat_code, page_codigos, mrows)

            page_accepted = 0
            page_rejected = 0
            page_reasons: Counter[str] = Counter()

            for prow, codigo in zip(proximal_rows, page_codigos):
                stats["extracted"] += 1

                override = overrides.get(codigo)
                used_vision_nutrients = bool(override and override.get("nutrientes"))
                raw_cells = dict(prow.cells)
                if used_vision_nutrients:
                    for key, value in override["nutrientes"].items():
                        raw_cells[key] = str(value)
                    overrides_applied.add(codigo)

                solution, used_shift = solve_row_with_fallback(raw_cells)
                nombre = clean_text(prow.nombre_ocr)
                if override and override.get("nombre"):
                    nombre = override["nombre"]
                    overrides_applied.add(codigo)
                elif nombre:
                    nombre = fix_accents(nombre)
                if not nombre:
                    nombre = f"(sin nombre OCR, {codigo})"
                parte = clean_text(prow.parte_analizada_ocr)

                mrow = mineral_by_codigo.get(codigo)
                micro_vals: dict[str, float] = {}
                top_extra: dict[str, float | None] = dict.fromkeys(
                    TOP_LEVEL_KEYS_IN_MINERAL_BLOCK
                )
                edible_pct = None
                if mrow is not None:
                    mineral_values = solve_mineral_values(mrow.cells)
                    for key in MICRO_KEYS_IN_MINERAL_BLOCK:
                        value = mineral_values.get(key)
                        if value is not None:
                            micro_vals[key] = value
                    for key in TOP_LEVEL_KEYS_IN_MINERAL_BLOCK:
                        top_extra[key] = mineral_values.get(key)
                    edible_pct = mineral_values.get("edible_portion_pct")

                record = {
                    "codigo": codigo,
                    "nombre": nombre,
                    "categoria": {"codigo": cat_code, "nombre": cat_name},
                    "parte_analizada": parte,
                    "edible_portion_pct": edible_pct,
                    "nutrientes": {
                        "energy_kcal": solution.values.get("energy_kcal"),
                        "energy_kj": solution.values.get("energy_kj"),
                        "protein_g": solution.values.get("protein_g"),
                        "fat_g": solution.values.get("fat_g"),
                        "carbs_g": solution.values.get("carbs_g"),
                        "carbs_available_g": solution.values.get("carbs_available_g"),
                        "fiber_g": solution.values.get("fiber_g"),
                        "moisture_g": solution.values.get("moisture_g"),
                        "ash_g": solution.values.get("ash_g"),
                        **top_extra,
                    },
                    "micronutrients": micro_vals,
                    "source_page": page,
                    "source_page_mineral": mineral_page if mrow is not None else None,
                    "confidence": "vision" if used_vision_nutrients else solution.confidence,
                    "invariants": solution.invariants,
                    "needs_review": not solution.passes_gate,
                    "no_carbs_available_column": used_shift,
                }

                if solution.passes_gate:
                    foods.append(record)
                    stats["accepted"] += 1
                    page_accepted += 1
                    if used_shift:
                        stats["accepted_via_shift"] += 1
                else:
                    stats["rejected"] += 1
                    page_rejected += 1
                    for inv_name, ok in solution.invariants.items():
                        if not ok:
                            invariant_failures[inv_name] += 1
                            page_reasons[inv_name] += 1
                    rejected.append({**record, "raw_cells": prow.cells, "notes": solution.notes})

            stats["phantom_rows"] += phantom_rows
            page_stats.append({
                "page": page,
                "category": cat_code,
                "rows_seen": len(all_proximal_rows),
                "phantom_rows_dropped": phantom_rows,
                "rows_parsed": len(proximal_rows),
                "accepted": page_accepted,
                "rejected": page_rejected,
                "reject_reasons": dict(page_reasons),
                "mineral_page": mineral_page if mineral_page <= end else None,
                "mineral_rows_matched": len(mineral_by_codigo),
            })

            page += 2

    foods.sort(key=lambda item: item["codigo"])

    unused_overrides = sorted(set(overrides) - overrides_applied)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(foods, f, ensure_ascii=False, indent=2)
        f.write("\n")

    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with AUDIT_PATH.open("w", encoding="utf-8") as f:
        json.dump(rejected, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with STATS_PATH.open("w", encoding="utf-8") as f:
        json.dump({
            "totals": {
                "extracted": stats["extracted"],
                "accepted": stats["accepted"],
                "accepted_via_no_carbs_available_shift": stats["accepted_via_shift"],
                "rejected": stats["rejected"],
                "phantom_rows_dropped": stats["phantom_rows"],
                "invariant_failures": dict(invariant_failures),
                "vision_overrides_applied": sorted(overrides_applied),
                "vision_overrides_unused": unused_overrides,
            },
            "pages": page_stats,
        }, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return {
        "extracted": stats["extracted"],
        "accepted": stats["accepted"],
        "accepted_via_no_carbs_available_shift": stats["accepted_via_shift"],
        "rejected": stats["rejected"],
        "phantom_rows_dropped": stats["phantom_rows"],
        "invariant_failures": dict(invariant_failures),
        "vision_overrides_applied": len(overrides_applied),
        "vision_overrides_unused": unused_overrides,
        "output": str(OUTPUT_PATH),
        "stats_detail": str(STATS_PATH),
    }


if __name__ == "__main__":
    from .render import render_all

    render_all()
    summary = run()
    print(json.dumps(summary, indent=2), file=sys.stderr)
