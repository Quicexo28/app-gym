"""¿Hay senal predecible en los logs de gimnasio, o el objetivo es ruido?

Antes de cambiar el motor hay que saber si el problema es *el motor* o *el
objetivo*. Este probe no usa el motor: construye a mano un punado de features
obvias del historial y entrena una regresion logistica para predecir lo mismo
que se le pidio al motor ("¿sube el 1RM estimado en los proximos 28 dias?").

Validacion: leave-one-athlete-out. Ningun atleta aparece a la vez en train y en
test, asi que el numero no esta inflado por memorizar a una persona.

Lectura del resultado:
- Si la logistica tampoco le gana a la clase mayoritaria -> el objetivo es poco
  predecible con este historial: hay que cambiar el objetivo o conseguir mas
  senal (RPE real, sueno, peso corporal...), no cambiar de modelo.
- Si le gana -> hay senal que el motor actual esta dejando sobre la mesa, y
  tiene sentido invertir en modelado.

Uso:
    python scripts/backtest/gym_signal_probe.py /tmp/gymlogs
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import numpy as np

from scripts.backtest.gym_backtest import (
    EVAL_EVERY_DAYS,
    MIN_PERF_SAMPLES,
    MIN_SESSIONS_PREFIX,
    WINDOW_DAYS,
    epley_1rm,
    main_exercise,
    parse_log,
    to_sessions,
)

FEATURES = (
    "vol_28d",  # volumen de las ultimas 4 semanas (log)
    "acwr",  # carga aguda (7d) sobre cronica (28d): clasico de monitoreo
    "freq_28d",  # sesiones en 4 semanas
    "e1rm_slope_56d",  # pendiente del 1RM estimado en 8 semanas (%/semana)
    "prev_change",  # cuanto cambio el 1RM en la ventana anterior
    "days_since_pr",  # dias desde el mejor 1RM historico
    "rel_to_pr",  # 1RM reciente sobre el mejor historico
    "history_days",  # antiguedad del historial
)


def build_rows(path: Path) -> list[dict]:
    parsed = parse_log(path)
    if not parsed:
        return []
    sessions = to_sessions(path.stem[:16], parsed)
    if len(sessions) < MIN_SESSIONS_PREFIX + 8:
        return []
    target_exercise = main_exercise(parsed)
    if target_exercise is None:
        return []

    volume: dict = {}
    perf: list = []
    for when, session in sessions:
        total = 0.0
        best = 0.0
        for exercise in session.exercises:
            for st in exercise.sets:
                total += (st.load_kg or 0.0) * st.reps
                if exercise.name == target_exercise and (st.load_kg or 0) > 0:
                    best = max(best, epley_1rm(st.load_kg, st.reps))
        volume[when] = total
        if best > 0:
            perf.append((when, best))

    def win_best(start, end):
        values = [v for t, v in perf if start < t <= end]
        return (max(values) if values else None, len(values))

    def win_vol(start, end):
        return sum(v for t, v in volume.items() if start < t <= end)

    def win_freq(start, end):
        return sum(1 for t in volume if start < t <= end)

    rows: list[dict] = []
    cursor = sessions[MIN_SESSIONS_PREFIX][0]
    last = sessions[-1][0] - timedelta(days=WINDOW_DAYS)
    first_day = sessions[0][0]

    while cursor <= last:
        past_best, past_n = win_best(cursor - timedelta(days=WINDOW_DAYS), cursor)
        future_best, future_n = win_best(cursor, cursor + timedelta(days=WINDOW_DAYS))
        if past_best is None or future_best is None or past_n < MIN_PERF_SAMPLES or future_n < MIN_PERF_SAMPLES:
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue

        prev_best, _ = win_best(
            cursor - timedelta(days=2 * WINDOW_DAYS), cursor - timedelta(days=WINDOW_DAYS)
        )
        vol28 = win_vol(cursor - timedelta(days=28), cursor)
        vol7 = win_vol(cursor - timedelta(days=7), cursor)
        history = [(t, v) for t, v in perf if t <= cursor]
        best_ever = max(v for _, v in history)
        best_day = max(history, key=lambda kv: kv[1])[0]

        recent = [(t, v) for t, v in perf if cursor - timedelta(days=56) < t <= cursor]
        if len(recent) >= 3:
            xs = np.array([(t - recent[0][0]).days / 7.0 for t, _ in recent])
            ys = np.array([v for _, v in recent])
            slope = float(np.polyfit(xs, ys, 1)[0]) / (ys.mean() or 1.0)
        else:
            slope = 0.0

        rows.append(
            {
                "athlete": path.stem[:16],
                "y": 1 if (future_best - past_best) / past_best > 0.02 else 0,
                "vol_28d": float(np.log1p(vol28)),
                "acwr": float((vol7 * 4.0) / vol28) if vol28 else 1.0,
                "freq_28d": float(win_freq(cursor - timedelta(days=28), cursor)),
                "e1rm_slope_56d": slope,
                "prev_change": ((past_best - prev_best) / prev_best) if prev_best else 0.0,
                "days_since_pr": float((cursor - best_day).days),
                "rel_to_pr": float(past_best / best_ever) if best_ever else 1.0,
                "history_days": float((cursor - first_day).days),
            }
        )
        cursor += timedelta(days=EVAL_EVERY_DAYS)
    return rows


def fit_logistic(x: np.ndarray, y: np.ndarray, epochs: int = 4000, lr: float = 0.08) -> np.ndarray:
    """Regresion logistica con descenso de gradiente y regularizacion L2."""
    weights = np.zeros(x.shape[1])
    for _ in range(epochs):
        p = 1.0 / (1.0 + np.exp(-x @ weights))
        grad = x.T @ (p - y) / len(y) + 0.01 * weights
        weights -= lr * grad
    return weights


def standardize(train: np.ndarray, other: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mean = train.mean(axis=0)
    std = train.std(axis=0)
    std[std == 0] = 1.0
    return (train - mean) / std, (other - mean) / std


def auc(scores: np.ndarray, labels: np.ndarray) -> float | None:
    pos = scores[labels == 1]
    neg = scores[labels == 0]
    if len(pos) == 0 or len(neg) == 0:
        return None
    wins = sum(float((p > neg).sum() + 0.5 * (p == neg).sum()) for p in pos)
    return wins / (len(pos) * len(neg))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    args = parser.parse_args()

    rows: list[dict] = []
    for path in sorted(args.data_dir.glob("*.csv")):
        rows.extend(build_rows(path))

    by_athlete: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_athlete[row["athlete"]].append(row)
    athletes = [a for a, rs in by_athlete.items() if len(rs) >= 4]

    preds: list[float] = []
    truth: list[int] = []
    for held_out in athletes:
        train_rows = [r for a in athletes if a != held_out for r in by_athlete[a]]
        test_rows = by_athlete[held_out]
        x_tr = np.array([[r[f] for f in FEATURES] for r in train_rows], dtype=float)
        y_tr = np.array([r["y"] for r in train_rows], dtype=float)
        x_te = np.array([[r[f] for f in FEATURES] for r in test_rows], dtype=float)

        x_tr_s, x_te_s = standardize(x_tr, x_te)
        x_tr_s = np.hstack([x_tr_s, np.ones((len(x_tr_s), 1))])
        x_te_s = np.hstack([x_te_s, np.ones((len(x_te_s), 1))])

        weights = fit_logistic(x_tr_s, y_tr)
        p = 1.0 / (1.0 + np.exp(-x_te_s @ weights))
        preds.extend(p.tolist())
        truth.extend([r["y"] for r in test_rows])

    scores = np.array(preds)
    labels = np.array(truth)
    prevalence = labels.mean()
    majority = max(prevalence, 1 - prevalence)
    acc = float(((scores > 0.5).astype(int) == labels).mean())
    brier = float(((scores - labels) ** 2).mean())
    brier_base = float(((prevalence - labels) ** 2).mean())

    print(
        json.dumps(
            {
                "n": int(len(labels)),
                "atletas": len(athletes),
                "prevalencia_sube": float(prevalence),
                "logistica_loao": {
                    "acierto": acc,
                    "auc": auc(scores, labels),
                    "brier": brier,
                },
                "baselines": {
                    "clase_mayoritaria": float(majority),
                    "brier_prevalencia": brier_base,
                },
                "skill_score_brier": float(1 - brier / brier_base) if brier_base else None,
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
