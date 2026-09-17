"""Decimal-comma solver + the three TCAC invariants (gate).

Tesseract reliably reads the *digits* of a TCAC cell but frequently drops
the decimal comma (``12,0`` -> ``120``) or, more rarely, misreads a digit
as a similarly-shaped letter (``9,1`` -> ``a1``). This module:

  1. Reconstructs a numeric value from raw OCR text using the column's
     known decimal-place convention (every TCAC column always prints the
     same number of decimals -- 0, 1 or 2 -- so once digits are recovered,
     re-inserting the comma is deterministic, not a guess).
  2. Falls back to a small bounded search over alternate decimal
     placements when the deterministic reconstruction fails the row's
     invariants (only relevant to the 9 ANALISIS PROXIMAL columns, which
     are the only columns the 3 invariants constrain).
  3. Exposes the 3 invariants themselves so build.py (extraction) and
     tests/test_tcac_seed.py (re-verification of the shipped JSON) share
     one implementation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Per-column decimal-place convention, empirically confirmed by inspecting
# every value in several sample pages (see docs/modulo-dieta.md section 8
# and the pipeline's own dev notes): each column always prints a fixed
# number of decimals, regardless of magnitude.
# ---------------------------------------------------------------------------
DECIMALS: dict[str, int] = {
    # Analisis proximal
    "moisture_g": 1,
    "energy_kcal": 0,
    "energy_kj": 0,
    "protein_g": 1,
    "fat_g": 1,
    "carbs_g": 1,
    "carbs_available_g": 1,
    "fiber_g": 1,
    "ash_g": 1,
    # Minerales
    "calcium_mg": 0,
    "iron_mg": 1,
    "sodium_mg": 0,
    "phosphorus_mg": 0,
    "iodine_ug": 1,
    "zinc_mg": 1,
    "magnesium_mg": 0,
    "potassium_mg": 0,
    # Vitaminas
    "thiamin_mg": 2,
    "riboflavin_mg": 2,
    "niacin_mg": 1,
    "folate_ug": 0,
    "vitamin_b12_ug": 2,
    "vitamin_c_mg": 0,
    "vitamin_a_ug": 0,
    # Acidos grasos y colesterol / parte comestible
    "sat_fat_g": 1,
    "fat_monounsaturated_g": 1,
    "fat_polyunsaturated_g": 1,
    "cholesterol_mg": 0,
    "edible_portion_pct": 0,
}

# Generous plausible per-100g ranges, used only to rank alternate decimal
# placements (never to silently clamp/invent a value).
PLAUSIBLE_RANGE: dict[str, tuple[float, float]] = {
    "moisture_g": (0, 100),
    "energy_kcal": (0, 950),
    "energy_kj": (0, 4000),
    "protein_g": (0, 95),
    "fat_g": (0, 100),
    "carbs_g": (0, 100),
    "carbs_available_g": (0, 100),
    "fiber_g": (0, 60),
    "ash_g": (0, 15),
    "calcium_mg": (0, 2500),
    "iron_mg": (0, 60),
    "sodium_mg": (0, 15000),
    "phosphorus_mg": (0, 1600),
    "iodine_ug": (0, 1200),
    "zinc_mg": (0, 20),
    "magnesium_mg": (0, 800),
    "potassium_mg": (0, 3200),
    "thiamin_mg": (0, 6),
    "riboflavin_mg": (0, 6),
    "niacin_mg": (0, 60),
    "folate_ug": (0, 1100),
    "vitamin_b12_ug": (0, 150),
    "vitamin_c_mg": (0, 1200),
    "vitamin_a_ug": (0, 32000),
    "sat_fat_g": (0, 100),
    "fat_monounsaturated_g": (0, 100),
    "fat_polyunsaturated_g": (0, 100),
    "cholesterol_mg": (0, 3200),
    "edible_portion_pct": (0, 100),
}

# Common tesseract confusions for glyphs that resemble a digit in this
# table's font, applied before extracting the digit string. Confirmed
# real-world instances (docs/modulo-dieta.md sec. 8.2): 9,1 -> a1;
# 11,4 -> M4; 9,6 -> 06 (letter O misread the other way is also common).
_DIGIT_CONFUSION = str.maketrans(
    {
        "O": "0", "o": "0", "D": "0", "Q": "0",
        "I": "1", "l": "1", "i": "1",
        "S": "5", "s": "5",
        "B": "8",
        "Z": "2", "z": "2",
        "G": "6",
        "g": "9",
        "b": "6",
        "A": "4",
        "a": "4",
        "T": "7",
        "M": "1",  # observed OCR artifact for a lost "11," ligature
    }
)

_DIRECT_RE = re.compile(r"^(\d{1,4})[.,](\d{1,3})$")


def _digits_from(raw: str) -> str:
    translated = raw.translate(_DIGIT_CONFUSION)
    return re.sub(r"[^0-9]", "", translated)


def _split_at(digits: str, decimals: int) -> float:
    if decimals == 0:
        return float(int(digits))
    if len(digits) <= decimals:
        int_part, dec_part = "0", digits.zfill(decimals)
    else:
        int_part, dec_part = digits[:-decimals] or "0", digits[-decimals:]
    return float(f"{int_part}.{dec_part}")


def reconstruct(raw_text: str, decimals: int) -> tuple[float | None, list[float]]:
    """Return (primary_value, ordered_candidate_values) for a raw OCR cell.

    ``primary_value`` is None when the cell is legitimately blank (TCAC has
    many empty cells for nutrients that were not analyzed -- these must
    stay null, never become 0). Candidates are deduplicated and ordered
    with the convention-based reconstruction first.

    Beyond the convention-based split, this also offers every other decimal
    placement of the same digit string, plus "one stray/missing digit"
    variants (drop each digit position once, then re-split at the column's
    convention). Both are still readings of the *same* OCR'd digits -- never
    an invented number -- so they stay legitimate candidates for the
    invariant-guided search in solve_proximal_row to pick from.
    """
    clean = raw_text.strip()
    if clean == "" or clean in {"-", ".", ","}:
        return None, []

    normalized = clean.replace(" ", "")
    translated = normalized.translate(_DIGIT_CONFUSION)

    candidates: list[float] = []

    direct_match = _DIRECT_RE.match(translated)
    if direct_match:
        candidates.append(float(f"{direct_match.group(1)}.{direct_match.group(2)}"))

    digits = _digits_from(normalized)
    if not digits:
        return None, []

    # Convention-based split first (the primary reading).
    candidates.append(_split_at(digits, decimals))

    # Every other decimal placement of the same digit string.
    for d in range(0, len(digits) + 1):
        candidates.append(_split_at(digits, d))

    # "One stray/missing digit" variants: OCR occasionally inserts or drops
    # a single spurious digit (anti-aliasing noise, a split glyph). Try
    # removing each digit position once and re-splitting at the column's
    # convention -- still the same OCR reading, just discounting one
    # character of it.
    if len(digits) > 1:
        for i in range(len(digits)):
            reduced = digits[:i] + digits[i + 1 :]
            if reduced:
                candidates.append(_split_at(reduced, decimals))

    ordered: list[float] = []
    for c in candidates:
        if c not in ordered:
            ordered.append(c)
    return ordered[0], ordered


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1]


def _digit_string(value: float, decimals: int) -> str:
    text = f"{value:.{decimals}f}" if decimals else str(int(round(value)))
    return text.replace(".", "").replace("-", "")


def pick_in_range(candidates: list[float], key: str) -> float | None:
    """Prefer the first candidate that falls in the nutrient's plausible
    range; otherwise fall back to the primary (first) candidate."""
    if not candidates:
        return None
    lo, hi = PLAUSIBLE_RANGE.get(key, (0, float("inf")))
    for c in candidates:
        if lo <= c <= hi:
            return c
    return candidates[0]


# ---------------------------------------------------------------------------
# The 3 invariants -- but only 2 of them are gates. See
# docs/modulo-dieta.md sec. 8.3 (tolerances corrected after measuring
# against the extracted JSON): mass balance (+/-2 g) and energy (+/-2 %)
# are the real gates. Atwater is kept only as a review-priority signal --
# its tolerance is wide and it never blocks a row from being accepted.
# ---------------------------------------------------------------------------

KJ_PER_KCAL = 4.184
# The physically-exact factor (1 kcal = 4.184 kJ) does not survive TCAC's
# own independent rounding of the two published columns, but the spread is
# small: measured against the extracted JSON, +/-1% rejected 181/327 rows
# (pure rounding noise) while +/-2% rejects only 2/327 (docs/modulo-dieta.md
# sec 8.3). +/-2% is the calibrated tolerance.
KJ_TOLERANCE = 0.02  # +/-2%, see note above
MASS_BALANCE_TOLERANCE_G = 2.0
# Atwater factors are approximations -- fibre, polioles, organic acids and
# TCAC's own per-food-group Atwater factors all shift the predicted kcal
# away from the generic 4/4/9 formula. Measured against the extracted JSON,
# the *median* deviation on otherwise-healthy rows is 11.5% and the p90 is
# 30% (docs/modulo-dieta.md sec 8.3) -- as a hard gate it rejects good data,
# so it is informational only: a wide tolerance used to flag rows for
# priority review, never to exclude them.
ATWATER_TOLERANCE = 0.12  # +/-12%, informational only -- not a gate

# The only two invariants that actually decide whether a row is seedable.
GATE_KEYS: tuple[str, ...] = ("kj_kcal", "mass_balance")


def kj_kcal_ok(kcal: float | None, kj: float | None) -> bool:
    if kcal is None or kj is None:
        return False
    expected = kcal * KJ_PER_KCAL
    if expected == 0:
        return abs(kj) < 5
    return abs(kj - expected) <= KJ_TOLERANCE * expected


def mass_balance_ok(
    moisture: float | None,
    protein: float | None,
    fat: float | None,
    carbs_total: float | None,
    ash: float | None,
) -> bool:
    values = [moisture, protein, fat, carbs_total, ash]
    if any(v is None for v in values):
        return False
    return abs(sum(values) - 100.0) <= MASS_BALANCE_TOLERANCE_G


def atwater_ok(
    kcal: float | None,
    protein: float | None,
    fat: float | None,
    carbs_total: float | None,
) -> bool:
    if kcal is None or protein is None or fat is None or carbs_total is None:
        return False
    predicted = 4 * protein + 4 * carbs_total + 9 * fat
    tolerance_base = max(predicted, kcal, 1e-6)
    return abs(kcal - predicted) <= ATWATER_TOLERANCE * tolerance_base


def evaluate_invariants(values: dict[str, float | None]) -> dict[str, bool]:
    return {
        "kj_kcal": kj_kcal_ok(values.get("energy_kcal"), values.get("energy_kj")),
        "mass_balance": mass_balance_ok(
            values.get("moisture_g"),
            values.get("protein_g"),
            values.get("fat_g"),
            values.get("carbs_g"),
            values.get("ash_g"),
        ),
        "atwater": atwater_ok(
            values.get("energy_kcal"),
            values.get("protein_g"),
            values.get("fat_g"),
            values.get("carbs_g"),
        ),
    }


def values_plausible(values: dict[str, float | None]) -> bool:
    """Sanity bound on the reconstructed values themselves, independent of
    the 2 gate invariants. kj_kcal_ok only checks the *ratio* between kcal
    and kJ, so a digit-duplication artifact (e.g. tesseract emitting
    "900 900" for one cell, reconstructed as 900900) that scales both
    energy columns by the same stray factor can satisfy the ratio while
    being physically absurd (no food is 900,900 kcal/100g). This isn't one
    of the 2 real gates (docs sec 8.3) -- it's a precondition so the search
    doesn't even consider a candidate combination that's already off by
    orders of magnitude before the ratio/sum checks get a chance to run.
    """
    for key in PROXIMAL_KEYS:
        v = values.get(key)
        if v is None:
            continue
        lo, hi = PLAUSIBLE_RANGE[key]
        if not (lo <= v <= hi):
            return False
    return True


def gate_ok(invariants: dict[str, bool]) -> bool:
    """The only two invariants that decide whether a row is seedable.
    Atwater is informational (see module docstring / GATE_KEYS) and never
    participates here."""
    return all(invariants[k] for k in GATE_KEYS)


def _gate_score(invariants: dict[str, bool]) -> int:
    """Ranks trials during the bounded search: satisfying a real gate key
    counts far more than satisfying Atwater, which is only a tiebreaker."""
    return 10 * sum(invariants[k] for k in GATE_KEYS) + (1 if invariants["atwater"] else 0)


PROXIMAL_KEYS = (
    "moisture_g", "energy_kcal", "energy_kj", "protein_g", "fat_g",
    "carbs_g", "carbs_available_g", "fiber_g", "ash_g",
)

# The 5 columns the mass-balance invariant sums to ~100g.
MASS_KEYS = ("moisture_g", "protein_g", "fat_g", "carbs_g", "ash_g")

# How many single-character edits (substitution/insertion/deletion) a
# balance-derived candidate's digit string is allowed to differ from the
# raw OCR digits actually read for that same cell. This is the guardrail
# against turning the mass-balance / energy invariants into a tautology:
# a derived candidate is only offered to the search if it is still
# recognizably a reading of what OCR saw in that specific cell (docs sec.
# 8.2 catalogs real single-glyph OCR confusions, e.g. 9,1 -> a1), never a
# number invented purely from the other columns.
MAX_DERIVED_EDIT_DISTANCE = 1


@dataclass
class RowSolution:
    values: dict[str, float | None]
    invariants: dict[str, bool]
    confidence: str  # high | medium | low | failed
    search_used: bool
    alternates_tried: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def passes_gate(self) -> bool:
        return gate_ok(self.invariants)


def _inject_derived_candidates(
    raw_cells: dict[str, str],
    primary: dict[str, float | None],
    alternates: dict[str, list[float]],
) -> None:
    """Add balance-equation-derived candidates, each guarded by digit
    similarity to that column's own OCR reading (see MAX_DERIVED_EDIT_DISTANCE).

    This is the deterministic "reinsert the decimal comma" move described in
    docs/modulo-dieta.md sec. 8.3: mass balance and the kJ/kcal checksum
    pin down which reading of the same digits is correct. It never invents
    a value unrelated to what OCR actually read in that cell.
    """
    for key in MASS_KEYS:
        raw = raw_cells.get(key, "")
        digits = _digits_from(raw.strip().replace(" ", ""))
        if not digits:
            continue
        others = [k for k in MASS_KEYS if k != key]
        if any(primary.get(k) is None for k in others):
            continue
        derived = round(100.0 - sum(primary[k] for k in others), 1)
        lo, hi = PLAUSIBLE_RANGE[key]
        if not (lo <= derived <= hi):
            continue
        if _levenshtein(_digit_string(derived, DECIMALS[key]), digits) <= MAX_DERIVED_EDIT_DISTANCE:
            if derived not in alternates[key]:
                alternates[key] = [*alternates[key], derived]

    kcal_raw = _digits_from(raw_cells.get("energy_kcal", "").strip().replace(" ", ""))
    kj_raw = _digits_from(raw_cells.get("energy_kj", "").strip().replace(" ", ""))
    if primary.get("energy_kcal") is not None and kj_raw:
        derived_kj = round(primary["energy_kcal"] * KJ_PER_KCAL)
        lo, hi = PLAUSIBLE_RANGE["energy_kj"]
        if lo <= derived_kj <= hi and _levenshtein(_digit_string(derived_kj, 0), kj_raw) <= MAX_DERIVED_EDIT_DISTANCE:
            if derived_kj not in alternates["energy_kj"]:
                alternates["energy_kj"] = [*alternates["energy_kj"], float(derived_kj)]
    if primary.get("energy_kj") is not None and kcal_raw:
        derived_kcal = round(primary["energy_kj"] / KJ_PER_KCAL)
        lo, hi = PLAUSIBLE_RANGE["energy_kcal"]
        if lo <= derived_kcal <= hi and _levenshtein(_digit_string(derived_kcal, 0), kcal_raw) <= MAX_DERIVED_EDIT_DISTANCE:
            if derived_kcal not in alternates["energy_kcal"]:
                alternates["energy_kcal"] = [*alternates["energy_kcal"], float(derived_kcal)]


def pick_carbs_available(
    candidates: list[float], carbs_total: float | None, fiber: float | None
) -> float | None:
    """Pick the carbs_available_g candidate closest to the physically
    expected value (carbs_total - fiber), and never one that ends up much
    smaller than that -- the bug this guards against is the decimal
    solver silently keeping a candidate an order of magnitude too small
    (e.g. 9.5 picked over 90.5) because nothing was constraining that
    column. Only chooses among candidates actually derived from the OCR'd
    digits for this cell (from ``reconstruct``) -- never invents a value.
    """
    if not candidates:
        return None
    if carbs_total is None:
        return candidates[0]
    target = carbs_total - (fiber or 0.0)
    # Available carbs can't exceed total carbs (small OCR/rounding slack).
    in_bounds = [c for c in candidates if c <= carbs_total + 0.15]
    pool = in_bounds or candidates
    return min(pool, key=lambda c: abs(c - target))


def solve_proximal_row(raw_cells: dict[str, str]) -> RowSolution:
    primary: dict[str, float | None] = {}
    alternates: dict[str, list[float]] = {}
    for key in PROXIMAL_KEYS:
        raw = raw_cells.get(key, "")
        value, cands = reconstruct(raw, DECIMALS[key])
        primary[key] = value
        alternates[key] = cands

    _inject_derived_candidates(raw_cells, primary, alternates)

    def finalize(vals: dict[str, float | None], invariants: dict[str, bool], confidence: str,
                 search_used: bool, tried: int, notes: list[str]) -> RowSolution:
        final = dict(vals)
        final["carbs_available_g"] = pick_carbs_available(
            alternates["carbs_available_g"], final.get("carbs_g"), final.get("fiber_g")
        )
        return RowSolution(
            values=final, invariants=invariants, confidence=confidence,
            search_used=search_used, alternates_tried=tried, notes=notes,
        )

    def accepted(inv: dict[str, bool], vals: dict[str, float | None]) -> bool:
        return gate_ok(inv) and values_plausible(vals)

    def score(inv: dict[str, bool], vals: dict[str, float | None]) -> int:
        # Plausibility dominates the ranking: a trial with an
        # order-of-magnitude artifact (see values_plausible's docstring)
        # should never outrank a merely gate-imperfect but sane trial.
        return (1000 if values_plausible(vals) else 0) + _gate_score(inv)

    invariants = evaluate_invariants(primary)
    if accepted(invariants, primary):
        return finalize(primary, invariants, "high", False, 0, [])

    # Bounded search: try swapping one column's reconstruction for one of
    # its alternate decimal placements (including balance/energy-derived
    # ones), then two columns at once. Only the columns the 2 real gates
    # touch (energy_kcal, energy_kj, and the 5 MASS_KEYS) need to change --
    # carbs_available_g and fiber_g never gate anything.
    tried = 0
    search_keys = [k for k in PROXIMAL_KEYS if k not in ("carbs_available_g", "fiber_g")]

    best_trial: tuple[dict[str, float | None], dict[str, bool]] = (primary, invariants)
    best_score = score(invariants, primary)

    for key in search_keys:
        for cand in alternates[key][1:]:
            trial = dict(primary)
            trial[key] = cand
            tried += 1
            trial_inv = evaluate_invariants(trial)
            if accepted(trial_inv, trial):
                return finalize(
                    trial, trial_inv, "medium", True, tried,
                    [f"resolved via alternate placement for {key}"],
                )
            trial_score = score(trial_inv, trial)
            if trial_score > best_score:
                best_score, best_trial = trial_score, (trial, trial_inv)

    for i, key1 in enumerate(search_keys):
        for key2 in search_keys[i + 1:]:
            for c1 in alternates[key1]:
                for c2 in alternates[key2]:
                    trial = dict(primary)
                    trial[key1] = c1
                    trial[key2] = c2
                    tried += 1
                    trial_inv = evaluate_invariants(trial)
                    if accepted(trial_inv, trial):
                        return finalize(
                            trial, trial_inv, "low", True, tried,
                            [f"resolved via alternate placement for {key1}+{key2}"],
                        )
                    trial_score = score(trial_inv, trial)
                    if trial_score > best_score:
                        best_score, best_trial = trial_score, (trial, trial_inv)

    best_vals, best_inv = best_trial
    return finalize(
        best_vals, best_inv, "failed", True, tried,
        ["no combination of alternate decimal placements satisfied the mass balance "
         "and energy gates; values shown are the closest trial found"],
    )
