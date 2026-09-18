"""Backtest del motor de prediccion contra datos reales de OpenPowerlifting.

Por que: sembrar datos sinteticos solo prueba que el pipeline corre. Para saber
si el motor *predice* hace falta historial real: se le da un prefijo de la
historia de un atleta y se compara lo que dice con lo que de verdad paso
despues (rolling-origin backtest, el prefijo nunca ve el futuro).

Dataset: OpenPowerlifting (dominio publico, ~4M filas, ~800k levantadores con
resultados de competencia fechados). No es un log de entrenamiento: cada meet
aporta un punto con los mejores intentos de sentadilla, banca y peso muerto.
Eso limita lo que se puede evaluar -- ver "Limitaciones" en el reporte.

Que se evalua (lo unico falsable sin contrafactual):
  1. `TrendDirection` del ultimo punto del prefijo (up / stable / down) contra
     la direccion real del total en el horizonte siguiente.
  2. `plateau` (probabilidad latente) contra "no hubo mejora real" en ese mismo
     horizonte (Brier score + AUC).
Los escenarios sugeridos (recovery / maintenance / variation) son
prescriptivos: no se pueden falsear sin saber que hubiera pasado si el atleta
hubiera hecho caso, asi que aqui no se evaluan.

Baselines con los que hay que comparar (si el motor no les gana, no aporta):
  - `always_stable`: decir siempre "estable".
  - `persistence`: repetir el signo del ultimo cambio observado.
  - `ols`: signo de la pendiente por minimos cuadrados sobre el prefijo.

Uso:
    python scripts/backtest/opl_backtest.py RUTA_CSV [--lifters N] [--horizon H]
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from coach_ai.e2e.runner import run_end_to_end
from coach_ai.e2e.types import EndToEndConfig
from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet

# --- parametros del experimento -------------------------------------------------

MIN_MEETS = 10  # historial minimo por levantador
MIN_PREFIX = 6  # puntos que ve el motor antes de la primera prediccion
DEAD_BAND = 0.025  # +-2.5% del total: por debajo de eso se considera "estable"

LIFTS = (
    ("Sentadilla", "Best3SquatKg"),
    ("Banca", "Best3BenchKg"),
    ("Peso muerto", "Best3DeadliftKg"),
)


@dataclass(frozen=True, slots=True)
class Meet:
    date: datetime
    squat: float
    bench: float
    deadlift: float
    total: float


def load_cohort(csv_path: Path, max_lifters: int, seed: int = 7) -> dict[str, list[Meet]]:
    """Levantadores con historial largo en competencia raw de potencia completa."""
    by_lifter: dict[str, list[Meet]] = defaultdict(list)

    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if row["Event"] != "SBD" or row["Equipment"] != "Raw":
                continue
            if row["Place"] in {"DQ", "DD", "NS", "G"}:
                continue
            try:
                squat = float(row["Best3SquatKg"])
                bench = float(row["Best3BenchKg"])
                deadlift = float(row["Best3DeadliftKg"])
                total = float(row["TotalKg"])
                date = datetime.strptime(row["Date"], "%Y-%m-%d").replace(tzinfo=UTC)
            except (ValueError, KeyError):
                continue
            if min(squat, bench, deadlift) <= 0 or total <= 0:
                continue
            by_lifter[row["Name"]].append(Meet(date, squat, bench, deadlift, total))

    eligible = {
        name: sorted(meets, key=lambda m: m.date)
        for name, meets in by_lifter.items()
        if len(meets) >= MIN_MEETS
    }
    # Un meet puede traer varias entradas del mismo levantador (divisiones): se
    # queda la mejor por fecha para no inflar la serie con duplicados.
    deduped: dict[str, list[Meet]] = {}
    for name, meets in eligible.items():
        best_by_date: dict[datetime, Meet] = {}
        for meet in meets:
            current = best_by_date.get(meet.date)
            if current is None or meet.total > current.total:
                best_by_date[meet.date] = meet
        series = [best_by_date[key] for key in sorted(best_by_date)]
        if len(series) >= MIN_MEETS:
            deduped[name] = series

    names = sorted(deduped)
    if max_lifters and len(names) > max_lifters:
        random.Random(seed).shuffle(names)
        names = names[:max_lifters]
    return {name: deduped[name] for name in names}


def to_sessions(athlete_id: str, meets: list[Meet]) -> list[Session]:
    """Un meet = una sesion con tres ejercicios de una serie a 1 repeticion.

    Con reps=1 el `volume_load_kg` del motor (suma de reps*carga) coincide con
    el total de competencia, que es justo la magnitud que se quiere seguir.
    """
    sessions: list[Session] = []
    for meet in meets:
        loads = {"Sentadilla": meet.squat, "Banca": meet.bench, "Peso muerto": meet.deadlift}
        sessions.append(
            Session(
                athlete_id=athlete_id,
                start_time=meet.date,
                duration_min=120.0,
                modality="strength",
                exercises=[
                    StrengthExercise(name=name, sets=[StrengthSet(reps=1, load_kg=loads[name])])
                    for name, _ in LIFTS
                ],
                source="openpowerlifting",
            )
        )
    return sessions


def _as_float(value: float | None) -> float | None:
    return float(value) if value is not None else None


def realized_label(prefix_last: float, future: list[float]) -> str:
    """Que paso de verdad despues, con banda muerta para no premiar el ruido."""
    change = (sum(future) / len(future) - prefix_last) / prefix_last
    if change > DEAD_BAND:
        return "up"
    if change < -DEAD_BAND:
        return "down"
    return "stable"


def ols_slope(values: list[float]) -> float:
    n = len(values)
    mean_x = (n - 1) / 2
    mean_y = sum(values) / n
    num = sum((i - mean_x) * (v - mean_y) for i, v in enumerate(values))
    den = sum((i - mean_x) ** 2 for i in range(n))
    return num / den if den else 0.0


def baseline_directions(totals: list[float]) -> dict[str, str]:
    """Predicciones triviales contra las que hay que comparar al motor."""
    last = totals[-1]
    prev = totals[-2] if len(totals) >= 2 else last
    delta = (last - prev) / prev if prev else 0.0
    persistence = "up" if delta > DEAD_BAND else "down" if delta < -DEAD_BAND else "stable"

    window = totals[-5:] if len(totals) >= 5 else totals
    slope = ols_slope(window) / (sum(window) / len(window))
    ols = "up" if slope > DEAD_BAND / 4 else "down" if slope < -DEAD_BAND / 4 else "stable"

    return {"always_stable": "stable", "persistence": persistence, "ols": ols}


def auc(scores: list[float], labels: list[int]) -> float | None:
    """AUC por conteo de pares (sin sklearn)."""
    pos = [s for s, y in zip(scores, labels, strict=True) if y == 1]
    neg = [s for s, y in zip(scores, labels, strict=True) if y == 0]
    if not pos or not neg:
        return None
    wins = 0.0
    for p in pos:
        for n in neg:
            wins += 1.0 if p > n else 0.5 if p == n else 0.0
    return wins / (len(pos) * len(neg))


def load_cohort_cached(csv_path: Path, max_lifters: int, cache: Path | None) -> dict[str, list[Meet]]:
    if cache and cache.exists():
        raw = json.loads(cache.read_text(encoding="utf-8"))
        return {
            name: [
                Meet(datetime.fromisoformat(m["d"]), m["s"], m["b"], m["dl"], m["t"]) for m in meets
            ]
            for name, meets in raw.items()
        }
    cohort = load_cohort(csv_path, max_lifters)
    if cache:
        cache.write_text(
            json.dumps(
                {
                    name: [
                        {"d": m.date.isoformat(), "s": m.squat, "b": m.bench, "dl": m.deadlift, "t": m.total}
                        for m in meets
                    ]
                    for name, meets in cohort.items()
                }
            ),
            encoding="utf-8",
        )
    return cohort


def run(
    csv_path: Path,
    max_lifters: int,
    horizon: int,
    slope_threshold: float,
    cache: Path | None,
) -> dict:
    cohort = load_cohort_cached(csv_path, max_lifters, cache)
    print(f"levantadores en cohorte: {len(cohort)}", file=sys.stderr)

    rows: list[dict] = []
    for name, meets in cohort.items():
        totals = [m.total for m in meets]
        sessions = to_sessions(name, meets)

        for k in range(MIN_PREFIX, len(meets) - horizon + 1):
            prefix = sessions[:k]
            future = totals[k : k + horizon]
            if len(future) < horizon:
                break

            config = EndToEndConfig(
                athlete_id=name, log_enabled=False, slope_threshold_norm=slope_threshold
            )
            try:
                result = run_end_to_end(prefix, config=config)
            except Exception as err:  # el motor no puede tumbar el backtest
                rows.append({"lifter": name, "k": k, "error": str(err)})
                continue

            trend = result.trend
            point = trend.points[-1] if trend and trend.points else None
            latent_states: dict[str, float | None] = {}
            if result.latents and result.latents.points:
                latent_states = result.latents.points[-1].states

            rows.append(
                {
                    "lifter": name,
                    "k": k,
                    "used_normalized": bool(trend.used_normalized) if trend else None,
                    "engine_direction": str(point.direction) if point else "insufficient",
                    "engine_confidence": float(point.confidence) if point else 0.0,
                    "plateau_p": _as_float(latent_states.get("plateau")),
                    "fatigue_p": _as_float(latent_states.get("fatigue")),
                    "readiness_p": _as_float(latent_states.get("readiness")),
                    "realized": realized_label(totals[k - 1], future),
                    "realized_change": (sum(future) / len(future) - totals[k - 1]) / totals[k - 1],
                    **{f"baseline_{k2}": v for k2, v in baseline_directions(totals[:k]).items()},
                }
            )

    return summarize(rows, horizon, slope_threshold)


def summarize(rows: list[dict], horizon: int, slope_threshold: float) -> dict:
    usable = [r for r in rows if "error" not in r]
    errors = len(rows) - len(usable)

    def accuracy(pred_key: str, subset: list[dict]) -> float | None:
        if not subset:
            return None
        hits = sum(1 for r in subset if r[pred_key] == r["realized"])
        return hits / len(subset)

    decided = [r for r in usable if r["engine_direction"] not in {"insufficient", "volatile"}]

    plateau_rows = [r for r in usable if r["plateau_p"] is not None]
    plateau_scores = [r["plateau_p"] for r in plateau_rows]
    plateau_labels = [1 if r["realized_change"] <= 0 else 0 for r in plateau_rows]
    brier = (
        sum((s - y) ** 2 for s, y in zip(plateau_scores, plateau_labels, strict=True))
        / len(plateau_rows)
        if plateau_rows
        else None
    )

    dist: dict[str, int] = defaultdict(int)
    for r in usable:
        dist[r["engine_direction"]] += 1
    realized_dist: dict[str, int] = defaultdict(int)
    for r in usable:
        realized_dist[r["realized"]] += 1

    prevalence = (sum(plateau_labels) / len(plateau_labels)) if plateau_labels else None
    # Brier de referencia: predecir siempre la prevalencia observada.
    brier_base = (
        sum((prevalence - y) ** 2 for y in plateau_labels) / len(plateau_labels)
        if plateau_labels
        else None
    )

    # Calibracion: si el motor dice 0.8 de plateau, ¿pasa el 80% de las veces?
    bins: dict[str, dict[str, float]] = {}
    for lo in (0.0, 0.2, 0.4, 0.6, 0.8):
        hi = lo + 0.2
        chunk = [
            (s_, y)
            for s_, y in zip(plateau_scores, plateau_labels, strict=True)
            if lo <= s_ < hi or (hi == 1.0 and s_ == 1.0)
        ]
        if chunk:
            bins[f"{lo:.1f}-{hi:.1f}"] = {
                "n": len(chunk),
                "p_media_motor": sum(c[0] for c in chunk) / len(chunk),
                "tasa_real_sin_mejora": sum(c[1] for c in chunk) / len(chunk),
            }

    return {
        "horizonte_meets": horizon,
        "slope_threshold_norm": slope_threshold,
        "predicciones": len(usable),
        "errores_motor": errors,
        "normalizacion_activa": sum(1 for r in usable if r["used_normalized"]),
        "distribucion_motor": dict(dist),
        "distribucion_real": dict(realized_dist),
        "acierto_direccion": {
            "motor_todas": accuracy("engine_direction", usable),
            "motor_sin_insuficiente_ni_volatil": accuracy("engine_direction", decided),
            "baseline_always_stable": accuracy("baseline_always_stable", usable),
            "baseline_persistence": accuracy("baseline_persistence", usable),
            "baseline_ols": accuracy("baseline_ols", usable),
        },
        "plateau": {
            "n": len(plateau_rows),
            "brier": brier,
            "auc_vs_sin_mejora": auc(plateau_scores, plateau_labels),
            "prevalencia_sin_mejora": prevalence,
            "brier_baseline_prevalencia": brier_base,
            "calibracion": bins,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--lifters", type=int, default=200)
    parser.add_argument("--horizon", type=int, default=2, help="meets futuros a evaluar")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--slope-threshold", type=float, default=0.05)
    parser.add_argument("--cohort-cache", type=Path, default=None)
    args = parser.parse_args()

    report = run(
        args.csv_path, args.lifters, args.horizon, args.slope_threshold, args.cohort_cache
    )
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
