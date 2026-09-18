"""Calibracion de la probabilidad `plateau` del motor.

El backtest mostro que `plateau` sale ~0.97 casi siempre mientras la tasa real
de "sin mejora" ronda 0.38: el numero que ve el usuario no significa lo que
dice. Calibrar no crea informacion (el AUC no cambia, es monotona), pero si
hace que un 0.7 quiera decir 70%.

Metodo: calibracion por bins de cuantil, ajustada con leave-one-athlete-out
para que la calibracion de un atleta nunca se entrene con sus propios datos.

Uso:
    python scripts/backtest/calibrate_plateau.py /tmp/gymlogs
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from scripts.backtest.gym_backtest import evaluate, parse_log


def calibrate_bins(
    x: np.ndarray, y: np.ndarray, n_bins: int = 10
) -> tuple[np.ndarray, np.ndarray]:
    """Calibracion por bins de cuantil: devuelve (bordes, tasa observada).

    Se eligio sobre la isotonica por una razon empirica: el 75% de las salidas
    del motor valen exactamente 0, y con esa cantidad de empates PAVA + interp
    daba un mapeo disparatado (media calibrada 0.84 contra una tasa real de
    0.39). Con bins, cada valor cae en su grupo y se le asigna la frecuencia
    observada de ese grupo. Sin empates ambos metodos coinciden.
    """
    edges = np.unique(np.quantile(x, np.linspace(0, 1, n_bins + 1)))
    if len(edges) < 2:
        edges = np.array([x.min(), x.max() + 1e-9])
    index = np.clip(np.digitize(x, edges[1:-1], right=True), 0, len(edges) - 2)
    rates = np.full(len(edges) - 1, float(y.mean()))
    for b in range(len(rates)):
        mask = index == b
        if mask.sum() >= 5:  # bins minusculos se quedan con la tasa global
            rates[b] = float(y[mask].mean())
    return edges, rates


def apply_bins(edges: np.ndarray, rates: np.ndarray, x_new: np.ndarray) -> np.ndarray:
    index = np.clip(np.digitize(x_new, edges[1:-1], right=True), 0, len(rates) - 1)
    return rates[index]


def brier(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    rows: list[dict] = []
    for path in sorted(args.data_dir.glob("*.csv")):
        parsed = parse_log(path)
        if parsed:
            rows.extend(evaluate(path.stem[:16], parsed))

    usable = [
        r for r in rows if "error" not in r and r.get("plateau_p") is not None
    ]
    by_athlete: dict[str, list[dict]] = defaultdict(list)
    for r in usable:
        by_athlete[r["athlete"]].append(r)
    athletes = [a for a, rs in by_athlete.items() if len(rs) >= 4]

    raw_p: list[float] = []
    cal_p: list[float] = []
    truth: list[int] = []

    for held_out in athletes:
        train = [r for a in athletes if a != held_out for r in by_athlete[a]]
        test = by_athlete[held_out]
        x_tr = np.array([float(r["plateau_p"]) for r in train])
        y_tr = np.array([1 if r["perf_change"] <= 0 else 0 for r in train])
        edges, rates = calibrate_bins(x_tr, y_tr)

        x_te = np.array([float(r["plateau_p"]) for r in test])
        y_te = [1 if r["perf_change"] <= 0 else 0 for r in test]
        raw_p.extend(x_te.tolist())
        cal_p.extend(apply_bins(edges, rates, x_te).tolist())
        truth.extend(y_te)

    raw = np.array(raw_p)
    cal = np.array(cal_p)
    y = np.array(truth)
    prevalence = float(y.mean())
    base = brier(np.full_like(cal, prevalence), y)

    # Si la calibracion esta bien hecha, la probabilidad media calibrada tiene
    # que quedar cerca de la tasa real. Si no, el mapeo esta roto.
    sanity_ok = abs(float(cal.mean()) - prevalence) < 0.1

    report = {
        "calibracion_sana": bool(sanity_ok),
        "n": int(len(y)),
        "atletas": len(athletes),
        "prevalencia_sin_mejora": prevalence,
        "brier": {
            "motor_crudo": brier(raw, y),
            "motor_calibrado": brier(cal, y),
            "baseline_prevalencia": base,
        },
        "skill_score": {
            "crudo": 1 - brier(raw, y) / base,
            "calibrado": 1 - brier(cal, y) / base,
        },
        "probabilidad_media": {
            "motor_crudo": float(raw.mean()),
            "motor_calibrado": float(cal.mean()),
            "tasa_real": prevalence,
        },
    }
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
