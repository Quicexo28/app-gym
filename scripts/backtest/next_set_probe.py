"""Objetivo nuevo: predecir la proxima serie tope, no "¿mejoraras en 28 dias?".

Motivacion (ver README): el objetivo a 28 dias es ruidoso y poco accionable. El
techo medido con features a mano fue AUC 0.57. Aqui se prueba el objetivo que si
usa el atleta: **cuanto vas a mover hoy en este ejercicio**. Es prediccion a un
paso, el error se mide en kg y se valida sola en la siguiente sesion.

Se evalua, por ejercicio y atleta:
  y = peso de la serie tope del ejercicio en su proxima sesion
  X = solo informacion anterior a esa sesion

Modelo: ridge (minimos cuadrados con regularizacion), validacion
leave-one-athlete-out. Baselines obligatorios:
  - `persistencia`: repetir el tope anterior (lo que haria cualquiera)
  - `media3`: media de los tres topes anteriores
  - `tendencia`: extrapolacion lineal de los tres anteriores

Incertidumbre: conformal split. Se calcula el cuantil de los residuos absolutos
en un fold de calibracion y se reporta la **cobertura empirica** del intervalo al
90% en test. Si la cobertura sale ~0.90, el intervalo es honesto.

Abstencion: con menos de MIN_HISTORY sesiones del ejercicio no se predice nada.

Uso:
    python scripts/backtest/next_set_probe.py /tmp/gymlogs
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np

from scripts.backtest.gym_backtest import parse_log

MIN_HISTORY = 6  # sesiones previas del ejercicio para no abstenerse
MIN_SESSIONS_EXERCISE = 12  # ejercicios con menos historia no entran
TOP_EXERCISES = 4  # cuantos ejercicios por atleta se evaluan
COVERAGE = 0.90

# Todo lo que entra al modelo va **relativo al ultimo tope** del propio
# ejercicio. Un press de 40 kg y una sentadilla de 200 kg no comparten escala:
# el primer intento predijo kg absolutos y por eso perdio contra repetir el
# ultimo valor. Lo que se modela es la desviacion respecto a esa persistencia.
FEATURES = (
    "rel_mean3",  # media de 3 topes / ultimo tope - 1
    "rel_max5",  # mejor de 5 / ultimo tope - 1
    "rel_slope3",  # pendiente de 3 topes / ultimo tope
    "rel_gap_to_max",  # cuanto falta al mejor historico
    "last_reps",
    "days_since",
    "sessions_done",
    "streak_up",
    "rel_volume",  # volumen de la ultima sesion / (tope x reps)
    "rpe_last",  # 0 si el log no trae RPE
    "has_rpe",
)


def sessions_by_exercise(rows) -> dict[str, list[dict]]:
    """Una entrada por (ejercicio, dia) con su serie tope y contexto."""
    grouped: dict[tuple[str, str], list] = defaultdict(list)
    for row in rows:
        grouped[(row.exercise, row.day)].append(row)

    out: dict[str, list[dict]] = defaultdict(list)
    for (exercise, day), sets in grouped.items():
        best = max(sets, key=lambda s: (s.weight_kg, s.reps))
        if best.weight_kg <= 0:
            continue
        out[exercise].append(
            {
                "day": day,
                "date": datetime.strptime(day, "%Y-%m-%d"),
                "top": best.weight_kg,
                "reps": best.reps,
                "e1rm": best.weight_kg * (1.0 + best.reps / 30.0),
                "volume": sum(s.weight_kg * s.reps for s in sets),
                "rpe": next((s.rpe for s in sets if getattr(s, "rpe", None)), None),
            }
        )
    for exercise in out:
        out[exercise].sort(key=lambda e: e["date"])
    return out


def build_samples(athlete: str, rows) -> list[dict]:
    by_exercise = sessions_by_exercise(rows)
    ranked = sorted(by_exercise.items(), key=lambda kv: -len(kv[1]))[:TOP_EXERCISES]

    samples: list[dict] = []
    for exercise, entries in ranked:
        if len(entries) < MIN_SESSIONS_EXERCISE:
            continue
        for i in range(MIN_HISTORY, len(entries)):
            past = entries[:i]
            target = entries[i]
            tops = [e["top"] for e in past]
            last3 = tops[-3:]
            slope = float(np.polyfit(range(len(last3)), last3, 1)[0]) if len(last3) >= 2 else 0.0
            streak = 0
            for a, b in zip(tops[-5:], tops[-4:], strict=False):
                streak = streak + 1 if b > a else 0
            rpe_values = [e["rpe"] for e in past[-3:] if e["rpe"] is not None]

            last = tops[-1]
            best_ever = max(tops)
            # Rejilla de discos: los pesos se mueven en escalones (2.5, 5...).
            # Una prediccion continua siempre cae entre dos valores posibles.
            steps = [abs(b - a) for a, b in zip(tops, tops[1:], strict=False) if abs(b - a) > 0.01]
            grid = min(steps) if steps else 2.5
            samples.append(
                {
                    "athlete": athlete,
                    "exercise": exercise,
                    "y_abs": target["top"],
                    # Objetivo: cuanto se desvia el proximo tope del ultimo, en
                    # proporcion. Persistencia = predecir 0.
                    "y": (target["top"] - last) / last,
                    "last_top": last,
                    "grid": float(grid),
                    "rel_mean3": float(np.mean(last3)) / last - 1.0,
                    "rel_max5": float(max(tops[-5:])) / last - 1.0,
                    "rel_slope3": slope / last,
                    "rel_gap_to_max": best_ever / last - 1.0,
                    "last_reps": float(past[-1]["reps"]),
                    "days_since": float(min((target["date"] - past[-1]["date"]).days, 60)),
                    "sessions_done": float(len(past)),
                    "streak_up": float(streak),
                    "rel_volume": float(past[-1]["volume"] / (last * max(past[-1]["reps"], 1))),
                    "rpe_last": float(np.mean(rpe_values)) if rpe_values else 0.0,
                    "has_rpe": 1.0 if rpe_values else 0.0,
                }
            )
    return samples


def ridge_fit(x: np.ndarray, y: np.ndarray, alpha: float = 1.0) -> np.ndarray:
    xtx = x.T @ x + alpha * np.eye(x.shape[1])
    return np.linalg.solve(xtx, x.T @ y)


def quantile_fit(
    x: np.ndarray, y: np.ndarray, tau: float = 0.5, epochs: int = 3000, lr: float = 0.02
) -> np.ndarray:
    """Regresion cuantil (pinball) por subgradiente.

    Ridge minimiza el error cuadratico y por eso persigue la media. Aqui la
    distribucion del cambio de peso tiene casi toda su masa en cero (la gente
    repite carga) con saltos ocasionales de 2.5-5 kg: la media es un mal
    resumen y el MAE lo castiga. La mediana condicional es el estimador que
    minimiza MAE, que es justo la metrica del problema.
    """
    weights = np.zeros(x.shape[1])
    for _ in range(epochs):
        residual = y - x @ weights
        grad = -x.T @ np.where(residual > 0, tau, tau - 1.0) / len(y)
        weights -= lr * grad
    return weights


def raw_matrix(samples: list[dict], features: tuple[str, ...]) -> np.ndarray:
    return np.array([[s[f] for f in features] for s in samples], dtype=float)


def design(
    samples: list[dict],
    features: tuple[str, ...],
    stats: tuple[np.ndarray, np.ndarray] | None = None,
) -> np.ndarray:
    """Matriz estandarizada + intercepto.

    Sin estandarizar, el descenso por subgradiente de la regresion cuantil
    diverge: `sessions_done` llega a cientos mientras el objetivo relativo vive
    en +-0.05.
    """
    matrix = raw_matrix(samples, features)
    if stats is not None:
        mean, std = stats
        matrix = (matrix - mean) / std
    return np.hstack([matrix, np.ones((len(matrix), 1))])


def fit_stats(samples: list[dict], features: tuple[str, ...]) -> tuple[np.ndarray, np.ndarray]:
    matrix = raw_matrix(samples, features)
    mean = matrix.mean(axis=0)
    std = matrix.std(axis=0)
    std[std == 0] = 1.0
    return mean, std


def run(samples: list[dict], features: tuple[str, ...]) -> dict:
    by_athlete: dict[str, list[dict]] = defaultdict(list)
    for s in samples:
        by_athlete[s["athlete"]].append(s)
    athletes = [a for a, rows in by_athlete.items() if len(rows) >= 10]

    errors_model: list[float] = []
    errors_median: list[float] = []
    errors_shrunk: list[float] = []
    errors_grid: list[float] = []
    lambdas: list[float] = []
    errors_persistence: list[float] = []
    errors_mean3: list[float] = []
    errors_trend: list[float] = []
    covered: list[int] = []
    widths: list[float] = []

    for held_out in athletes:
        train = [s for a in athletes if a != held_out for s in by_athlete[a]]
        test = by_athlete[held_out]
        if len(train) < 50:
            continue

        # split conformal: 80% ajuste, 20% calibracion del intervalo
        cut = int(len(train) * 0.8)
        fit_rows, cal_rows = train[:cut], train[cut:]
        if len(cal_rows) < 20:
            fit_rows, cal_rows = train, train

        stats = fit_stats(fit_rows, features)
        x_fit = design(fit_rows, features, stats)
        y_fit = np.array([s["y"] for s in fit_rows])
        weights = ridge_fit(x_fit, y_fit)
        weights_median = quantile_fit(x_fit, y_fit)

        cal_residuals = np.abs(
            np.array([s["y"] for s in cal_rows]) - design(cal_rows, features, stats) @ weights
        )
        quantile = float(np.quantile(cal_residuals, COVERAGE))

        # Shrinkage hacia persistencia: la prediccion final es
        # last * (1 + lambda * delta_estimado). Lambda sale del fold de
        # calibracion, no del test. Si el modelo no aporta, lambda tiende a 0 y
        # el sistema degenera -- correctamente -- en "repite el ultimo peso".
        cal_last = np.array([s["last_top"] for s in cal_rows])
        cal_abs = np.array([s["y_abs"] for s in cal_rows])
        cal_delta = design(cal_rows, features, stats) @ weights_median
        best_lambda, best_err = 0.0, float("inf")
        for lam in np.linspace(0.0, 1.0, 21):
            err = float(np.mean(np.abs(cal_last * (1.0 + lam * cal_delta) - cal_abs)))
            if err < best_err:
                best_lambda, best_err = float(lam), err
        lambdas.append(best_lambda)

        x_te = design(test, features, stats)
        last_te = np.array([s["last_top"] for s in test])
        y_abs = np.array([s["y_abs"] for s in test])
        pred = last_te * (1.0 + x_te @ weights)  # delta relativo -> kg

        pred_median = last_te * (1.0 + x_te @ weights_median)
        errors_model.extend(np.abs(pred - y_abs).tolist())
        errors_median.extend(np.abs(pred_median - y_abs).tolist())

        delta_te = x_te @ weights_median
        shrunk = last_te * (1.0 + best_lambda * delta_te)
        errors_shrunk.extend(np.abs(shrunk - y_abs).tolist())

        grid = np.array([s["grid"] for s in test])
        snapped = np.round(shrunk / grid) * grid
        errors_grid.extend(np.abs(snapped - y_abs).tolist())
        errors_persistence.extend(np.abs(last_te - y_abs).tolist())
        errors_mean3.extend(
            np.abs(last_te * (1.0 + np.array([s["rel_mean3"] for s in test])) - y_abs).tolist()
        )
        trend = last_te * (1.0 + np.array([s["rel_slope3"] for s in test]))
        errors_trend.extend(np.abs(trend - y_abs).tolist())

        # El intervalo conformal se calibra en la escala relativa y se lleva a kg
        # con el ultimo tope de cada muestra: un intervalo fijo en kg no sirve
        # para ejercicios de escalas distintas.
        half_width = quantile * last_te
        covered.extend((np.abs(pred - y_abs) <= half_width).astype(int).tolist())
        widths.extend((2 * half_width).tolist())

    def mae(values: list[float]) -> float | None:
        return float(np.mean(values)) if values else None

    def within(values: list[float], kg: float) -> float | None:
        return float(np.mean([v <= kg for v in values])) if values else None

    return {
        "n": len(errors_model),
        "atletas": len(athletes),
        "mae_kg": {
            "ridge": mae(errors_model),
            "mediana_pinball": mae(errors_median),
            "mediana_con_shrinkage": mae(errors_shrunk),
            "shrinkage_en_rejilla": mae(errors_grid),
            "persistencia": mae(errors_persistence),
            "media3": mae(errors_mean3),
            "tendencia": mae(errors_trend),
        },
        "dentro_de_2.5kg": {
            "ridge": within(errors_model, 2.5),
            "mediana_pinball": within(errors_median, 2.5),
            "mediana_con_shrinkage": within(errors_shrunk, 2.5),
            "shrinkage_en_rejilla": within(errors_grid, 2.5),
            "persistencia": within(errors_persistence, 2.5),
        },
        "lambda_medio": float(np.mean(lambdas)) if lambdas else None,
        "conformal_90": {
            "cobertura_empirica": float(np.mean(covered)) if covered else None,
            "ancho_medio_kg": float(np.mean(widths)) if widths else None,
            "ancho_mediano_kg": float(np.median(widths)) if widths else None,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    samples: list[dict] = []
    for path in sorted(args.data_dir.glob("*.csv")):
        rows = parse_log(path)
        if rows:
            samples.extend(build_samples(path.stem[:16], rows))

    full = run(samples, FEATURES)
    # Ablacion: las mismas features sin nada de RPE, para ver si aporta algo.
    no_rpe = tuple(f for f in FEATURES if f not in {"rpe_last", "has_rpe"})
    ablation = run(samples, no_rpe)
    with_rpe = [s for s in samples if s["has_rpe"] == 1.0]

    deltas = np.array([s["y_abs"] - s["last_top"] for s in samples])
    report = {
        "objetivo": {
            "delta_exactamente_0": float(np.mean(deltas == 0)),
            "delta_abs_menor_2.5kg": float(np.mean(np.abs(deltas) <= 2.5)),
            "delta_mediano_kg": float(np.median(deltas)),
            "delta_p90_abs_kg": float(np.quantile(np.abs(deltas), 0.9)),
        },
        "muestras": len(samples),
        "muestras_con_rpe": len(with_rpe),
        "completo": full,
        "sin_features_de_rpe": ablation,
    }
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
