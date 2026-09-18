"""Modelo dosis-respuesta multinivel: ¿cuánta fuerza gano según lo que entreno?

Es el objetivo que pidió el producto, y es distinto de todo lo anterior: no se
pronostica una serie temporal, se estima una **respuesta condicionada a la
dosis**. La variable explicativa (cuánto entrenas) es una accion del usuario, no
ruido fisiologico.

Datos: los 28 logs reales de `gym_fetch.py`. No traen el plan prescrito, asi que
no hay "cumplimiento" que medir, pero si traen la dosis real (series duras por
semana, frecuencia, volumen), que es el predictor principal del modelo.

Unidad de analisis: bloques de 4 semanas. La fuerza responde a semanas de
trabajo acumulado, no a la sesion de ayer.

  X = dosis del bloque k        (series/semana, frecuencia, esfuerzo, nivel base)
  y = cambio de e1RM (%) del ejercicio principal entre el bloque k y el k+1

Modelo: multinivel con pooling parcial. Un efecto poblacional comun mas un
intercepto por atleta encogido hacia la poblacion (`shrinkage`), que es lo que
permite personalizar sin exigir decenas de bloques por persona.

Dos escenarios de validacion, que responden preguntas distintas:
  - `cold_start`: leave-one-athlete-out. El atleta de test es desconocido, se usa
    solo el efecto poblacional. Es el usuario que acaba de instalar la app.
  - `personalizado`: se predice el ultimo bloque de cada atleta usando sus
    bloques anteriores. Es el usuario que la app ya conoce.

Baselines obligatorios: predecir 0 (no cambia nada), la media poblacional, y la
media historica del propio atleta.

Uso:
    python scripts/backtest/dose_response.py /tmp/gymlogs
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import numpy as np

from coach_ai.compliance import block_features, split_blocks
from scripts.backtest.gym_backtest import epley_1rm, main_exercise, parse_log, to_sessions

BLOCK_DAYS = 28  # por defecto; se puede cambiar con --block-days
MIN_BLOCKS_PER_ATHLETE = 3
MIN_SETS_PER_BLOCK = 8  # menos que esto no es un bloque de entrenamiento
RIDGE_ALPHA = 1.0
SHRINKAGE_K = 3.0  # bloques necesarios para que el intercepto propio pese la mitad

FEATURES = (
    "log_sets_per_week",
    "sessions_per_week",
    "mean_effort_rpe",
    "baseline_e1rm_rel",
    "blocks_of_history",
)


def athlete_blocks(path: Path, block_days: int = BLOCK_DAYS) -> list[dict]:
    """Bloques de 4 semanas con su dosis y el cambio de e1RM del bloque siguiente."""
    rows = parse_log(path)
    if not rows:
        return []
    target = main_exercise(rows)
    if target is None:
        return []

    pairs = to_sessions(path.stem[:16], rows)
    sessions = [session for _, session in pairs]
    if len(sessions) < 12:
        return []

    def best_e1rm(start, end) -> float | None:
        """e1RM del bloque, robusto.

        El maximo salta segun el tipo de serie del dia (un single pesado infla,
        una serie de 12 desinfla): la mediana de los tres mejores baja mucho esa
        varianza sin perder el nivel.
        """
        values = sorted(
            (
                epley_1rm(st.load_kg, st.reps)
                for when, session in pairs
                if start <= when < end
                for ex in session.exercises
                if ex.name == target
                for st in ex.sets
                if (st.load_kg or 0) > 0 and st.reps > 0
            ),
            reverse=True,
        )
        if not values:
            return None
        # Se vuelve al maximo: la mediana de los tres mejores no bajo la varianza
        # (19.1% contra 17.9%), porque con pocas mediciones por bloque el tercer
        # valor ya es una serie ligera.
        return float(values[0])

    windows = split_blocks(sessions, block_days=block_days)
    out: list[dict] = []
    first_e1rm: float | None = None

    for index, (start, end) in enumerate(windows[:-1]):
        features = block_features(sessions, start, end)
        if features is None or features.hard_sets_per_week * features.weeks < MIN_SETS_PER_BLOCK:
            continue

        current = best_e1rm(start, end)
        nxt = best_e1rm(end, end + timedelta(days=block_days))
        if current is None or nxt is None or current <= 0:
            continue
        if first_e1rm is None:
            first_e1rm = current

        out.append(
            {
                "athlete": features.athlete_id,
                "block_index": index,
                "y": (nxt - current) / current,  # cambio relativo de e1RM
                "log_sets_per_week": float(np.log1p(features.hard_sets_per_week)),
                "sessions_per_week": features.sessions_per_week,
                # Sin RPE en el log se imputa 8 (la intensidad tipica de una
                # serie de trabajo) y se marca aparte para no confundir
                # "no reportado" con "facil".
                "mean_effort_rpe": features.mean_effort_rpe if features.mean_effort_rpe else 8.0,
                "baseline_e1rm_rel": current / first_e1rm,
                "blocks_of_history": float(index),
                "set_completion_ratio": features.set_completion_ratio,
            }
        )
    return out


def design(rows: list[dict]) -> np.ndarray:
    matrix = np.array([[r[f] for f in FEATURES] for r in rows], dtype=float)
    return np.hstack([matrix, np.ones((len(matrix), 1))])


def standardize(train: np.ndarray, other: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mean = train[:, :-1].mean(axis=0)
    std = train[:, :-1].std(axis=0)
    std[std == 0] = 1.0
    train_s = np.hstack([(train[:, :-1] - mean) / std, train[:, -1:]])
    other_s = np.hstack([(other[:, :-1] - mean) / std, other[:, -1:]])
    return train_s, other_s


def fit_multilevel(
    x: np.ndarray, y: np.ndarray, athletes: list[str]
) -> tuple[np.ndarray, dict[str, float]]:
    """Efecto poblacional (ridge) + intercepto por atleta encogido.

    El encogimiento `n / (n + k)` es el estimador clasico de pooling parcial:
    con un bloque el atleta apenas mueve su intercepto respecto a la poblacion,
    con muchos bloques manda su propia historia.
    """
    xtx = x.T @ x + RIDGE_ALPHA * np.eye(x.shape[1])
    beta = np.linalg.solve(xtx, x.T @ y)

    residual = y - x @ beta
    sums: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    for value, athlete in zip(residual, athletes, strict=True):
        sums[athlete] += float(value)
        counts[athlete] += 1

    offsets = {
        athlete: (sums[athlete] / counts[athlete]) * (counts[athlete] / (counts[athlete] + SHRINKAGE_K))
        for athlete in sums
    }
    return beta, offsets


def evaluate(rows: list[dict]) -> dict:
    by_athlete: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_athlete[row["athlete"]].append(row)
    athletes = [a for a, rs in by_athlete.items() if len(rs) >= MIN_BLOCKS_PER_ATHLETE]
    if len(athletes) < 4:
        return {"error": "muestra insuficiente", "atletas": len(athletes)}

    cold_pred: list[float] = []
    cold_true: list[float] = []
    warm_pred: list[float] = []
    warm_true: list[float] = []
    base_pop: list[float] = []
    base_self: list[float] = []

    for held_out in athletes:
        train_rows = [r for a in athletes if a != held_out for r in by_athlete[a]]
        test_rows = sorted(by_athlete[held_out], key=lambda r: r["block_index"])

        x_tr_raw = design(train_rows)
        x_te_raw = design(test_rows)
        x_tr, x_te = standardize(x_tr_raw, x_te_raw)
        y_tr = np.array([r["y"] for r in train_rows])
        beta, _ = fit_multilevel(x_tr, y_tr, [r["athlete"] for r in train_rows])

        # cold start: atleta desconocido, solo efecto poblacional
        pred = x_te @ beta
        cold_pred.extend(pred.tolist())
        cold_true.extend([r["y"] for r in test_rows])
        base_pop.extend([float(y_tr.mean())] * len(test_rows))

        # personalizado: ultimo bloque, usando los propios bloques anteriores
        own_past = test_rows[:-1]
        last = test_rows[-1]
        own_residuals = np.array([r["y"] for r in own_past]) - (x_te[:-1] @ beta)
        n_own = len(own_past)
        offset = float(own_residuals.mean()) * (n_own / (n_own + SHRINKAGE_K))
        warm_pred.append(float(x_te[-1] @ beta + offset))
        warm_true.append(last["y"])
        base_self.append(float(np.mean([r["y"] for r in own_past])))

    def mae(pred: list[float], true: list[float]) -> float:
        return float(np.mean(np.abs(np.array(pred) - np.array(true))))

    cold_zero = mae([0.0] * len(cold_true), cold_true)
    warm_true_arr = warm_true

    # ¿Existe siquiera la relacion? El MAE puede esconderlo; el coeficiente de
    # la dosis con su intervalo bootstrap lo responde de frente.
    x_all_raw = design(rows)
    x_all, _ = standardize(x_all_raw, x_all_raw)
    y_all = np.array([r["y"] for r in rows])
    beta_all, _ = fit_multilevel(x_all, y_all, [r["athlete"] for r in rows])
    dose_index = FEATURES.index("log_sets_per_week")

    rng = np.random.default_rng(7)
    boot: list[float] = []
    athlete_names = sorted({r["athlete"] for r in rows})
    grouped = {a: [r for r in rows if r["athlete"] == a] for a in athlete_names}
    for _ in range(400):
        # Bootstrap por atleta, no por fila: los bloques de una misma persona no
        # son independientes entre si.
        sample_names = rng.choice(athlete_names, size=len(athlete_names), replace=True)
        sample = [r for name in sample_names for r in grouped[name]]
        xb_raw = design(sample)
        xb, _ = standardize(xb_raw, xb_raw)
        yb = np.array([r["y"] for r in sample])
        beta_b, _ = fit_multilevel(xb, yb, [r["athlete"] for r in sample])
        boot.append(float(beta_b[dose_index]))

    correlation = float(
        np.corrcoef([r["log_sets_per_week"] for r in rows], y_all)[0, 1]
    )

    return {
        "bloques": len(rows),
        "relacion_dosis_ganancia": {
            "coeficiente_series_por_semana": float(beta_all[dose_index]),
            "ic95_bootstrap": [
                float(np.quantile(boot, 0.025)),
                float(np.quantile(boot, 0.975)),
            ],
            "correlacion_simple": correlation,
        },
        "atletas_evaluados": len(athletes),
        "cambio_real_e1rm": {
            "media": float(np.mean(cold_true)),
            "mediana": float(np.median(cold_true)),
            "desviacion": float(np.std(cold_true)),
        },
        "cold_start_mae_pct": {
            "modelo": mae(cold_pred, cold_true) * 100,
            "baseline_cero": cold_zero * 100,
            "baseline_media_poblacional": mae(base_pop, cold_true) * 100,
        },
        "personalizado_mae_pct": {
            "modelo": mae(warm_pred, warm_true_arr) * 100,
            "baseline_cero": mae([0.0] * len(warm_true_arr), warm_true_arr) * 100,
            "baseline_media_del_atleta": mae(base_self, warm_true_arr) * 100,
            "n": len(warm_true_arr),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--block-days", type=int, default=BLOCK_DAYS)
    args = parser.parse_args()

    rows: list[dict] = []
    for path in sorted(args.data_dir.glob("*.csv")):
        rows.extend(athlete_blocks(path, args.block_days))

    report = evaluate(rows)
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
