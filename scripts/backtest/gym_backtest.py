"""Backtest del motor con logs reales de gimnasio (Strong / FitNotes).

Este es el test que de verdad importa para Alzo: mismos datos que registra la
app (fecha, ejercicio, series, repeticiones, peso) y la misma metrica que la app
muestra (`volume_load_kg`). Los logs los cosecha `gym_fetch.py` de repositorios
publicos; son personas reales, no simulaciones.

Dos preguntas separadas:

E1 - volumen futuro: la direccion de tendencia contra el volumen real de las
     4 semanas siguientes. El volumen lo decide el atleta, asi que acertar aqui
     no es todavia "predecir progreso".

E2 - fuerza futura: el 1RM estimado (Epley) del ejercicio principal del atleta
     en los 28 dias siguientes contra los 28 anteriores. Esto si es progreso.

Baselines obligatorios: clase mayoritaria y persistencia. Si el motor no les
gana, no esta aportando informacion.

Uso:
    python scripts/backtest/gym_fetch.py --out /tmp/gymlogs
    python scripts/backtest/gym_backtest.py /tmp/gymlogs
"""

from __future__ import annotations

import argparse
import csv
import io
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from coach_ai.e2e.runner import run_end_to_end
from coach_ai.e2e.types import EndToEndConfig
from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet

MIN_SESSIONS_PREFIX = 25
EVAL_EVERY_DAYS = 14
WINDOW_DAYS = 28
MIN_PERF_SAMPLES = 2
DEAD_BAND = 0.02  # +-2% en 1RM estimado
LOAD_DEAD_BAND = 0.10  # +-10% en volumen de 4 semanas
LB_TO_KG = 0.45359237


@dataclass(frozen=True, slots=True)
class SetRow:
    day: str
    exercise: str
    weight_kg: float
    reps: int
    # Strong exporta una columna RPE que casi nadie llena; cuando esta, es la
    # unica senal subjetiva disponible en estos logs.
    rpe: float | None = None


def _num(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        out = float(str(value).strip().replace(",", "."))
    except ValueError:
        return None
    return out if out == out else None


def parse_log(path: Path) -> list[SetRow]:
    text = path.read_bytes().decode("utf-8-sig", "replace")
    sample = text[:4096]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    fields = {f.strip(): f for f in (reader.fieldnames or [])}

    exercise_col = fields.get("Exercise Name") or fields.get("Exercise")
    date_col = fields.get("Date")
    reps_col = fields.get("Reps")
    weight_col = fields.get("Weight") or fields.get("Weight (kgs)") or fields.get("Weight (lbs)")
    rpe_col = fields.get("RPE") or fields.get("RIR")
    if not (exercise_col and date_col and reps_col and weight_col):
        return []
    to_kg = LB_TO_KG if weight_col.endswith("(lbs)") else 1.0

    rows: list[SetRow] = []
    for raw in reader:
        day = (raw.get(date_col) or "")[:10]
        exercise = (raw.get(exercise_col) or "").strip()
        weight = _num(raw.get(weight_col))
        reps = _num(raw.get(reps_col))
        if not day or not exercise or weight is None or reps is None:
            continue
        if reps <= 0 or weight < 0:
            continue
        rpe = _num(raw.get(rpe_col)) if rpe_col else None
        rows.append(SetRow(day, exercise, weight * to_kg, int(reps), rpe if rpe else None))
    rows.sort(key=lambda r: (r.day, r.exercise))
    return rows


def to_sessions(athlete_id: str, rows: list[SetRow]) -> list[tuple[datetime, Session]]:
    by_day: dict[str, dict[str, list[StrengthSet]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        by_day[row.day][row.exercise].append(StrengthSet(reps=row.reps, load_kg=row.weight_kg))

    sessions: list[tuple[datetime, Session]] = []
    for day in sorted(by_day):
        try:
            when = datetime.strptime(day, "%Y-%m-%d").replace(hour=18, tzinfo=UTC)
        except ValueError:
            continue
        exercises = [
            StrengthExercise(name=name, sets=sets) for name, sets in sorted(by_day[day].items())
        ]
        sessions.append(
            (
                when,
                Session(
                    athlete_id=athlete_id,
                    start_time=when,
                    # Los exports de fuerza no traen duracion fiable; la metrica
                    # que se usa (`volume_load_kg`) no depende de ella.
                    duration_min=60.0,
                    modality="strength",
                    exercises=exercises,
                    source="github-gym-logs",
                ),
            )
        )
    return sessions


def epley_1rm(weight_kg: float, reps: int) -> float:
    return weight_kg * (1.0 + reps / 30.0)


def main_exercise(rows: list[SetRow]) -> str | None:
    """El ejercicio con mas dias distintos: es el que sostiene la serie de fuerza."""
    days_by_exercise: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        if row.weight_kg > 0:
            days_by_exercise[row.exercise].add(row.day)
    if not days_by_exercise:
        return None
    return max(days_by_exercise.items(), key=lambda kv: len(kv[1]))[0]


def label(change: float, dead_band: float) -> str:
    if change > dead_band:
        return "up"
    if change < -dead_band:
        return "down"
    return "stable"


def evaluate(athlete_id: str, rows: list[SetRow]) -> list[dict]:
    sessions = to_sessions(athlete_id, rows)
    if len(sessions) < MIN_SESSIONS_PREFIX + 8:
        return []

    target = main_exercise(rows)
    if target is None:
        return []

    perf: list[tuple[datetime, float]] = []
    volume: dict[datetime, float] = {}
    for when, session in sessions:
        total = 0.0
        best = 0.0
        for exercise in session.exercises:
            for st in exercise.sets:
                total += (st.load_kg or 0.0) * st.reps
                if exercise.name == target and (st.load_kg or 0) > 0:
                    best = max(best, epley_1rm(st.load_kg, st.reps))
        volume[when] = total
        if best > 0:
            perf.append((when, best))

    def window_best(start: datetime, end: datetime) -> tuple[float | None, int]:
        values = [v for t, v in perf if start < t <= end]
        return (max(values) if values else None, len(values))

    def window_volume(start: datetime, end: datetime) -> float:
        return sum(v for t, v in volume.items() if start < t <= end)

    rows_out: list[dict] = []
    cursor = sessions[MIN_SESSIONS_PREFIX][0]
    last = sessions[-1][0] - timedelta(days=WINDOW_DAYS)

    while cursor <= last:
        prefix = [s for t, s in sessions if t <= cursor]
        if len(prefix) < MIN_SESSIONS_PREFIX:
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue

        past_best, past_n = window_best(cursor - timedelta(days=WINDOW_DAYS), cursor)
        future_best, future_n = window_best(cursor, cursor + timedelta(days=WINDOW_DAYS))
        if past_best is None or future_best is None:
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue
        if past_n < MIN_PERF_SAMPLES or future_n < MIN_PERF_SAMPLES:
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue

        prev_best, _ = window_best(
            cursor - timedelta(days=2 * WINDOW_DAYS), cursor - timedelta(days=WINDOW_DAYS)
        )
        past_volume = window_volume(cursor - timedelta(days=WINDOW_DAYS), cursor)
        future_volume = window_volume(cursor, cursor + timedelta(days=WINDOW_DAYS))

        config = EndToEndConfig(
            athlete_id=athlete_id, metric_key="volume_load_kg", log_enabled=False
        )
        try:
            result = run_end_to_end(prefix, config=config)
        except Exception as err:
            rows_out.append({"athlete": athlete_id, "error": str(err)})
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue

        point = result.trend.points[-1] if result.trend and result.trend.points else None
        states = (
            result.latents.points[-1].states if (result.latents and result.latents.points) else {}
        )
        perf_change = (future_best - past_best) / past_best
        prev_change = ((past_best - prev_best) / prev_best) if prev_best else 0.0

        rows_out.append(
            {
                "athlete": athlete_id,
                "t": cursor.date().isoformat(),
                "engine_direction": str(point.direction) if point else "insufficient",
                "plateau_p": states.get("plateau"),
                "perf_realized": label(perf_change, DEAD_BAND),
                "perf_change": perf_change,
                "baseline_persistence": label(prev_change, DEAD_BAND),
                "load_realized": label(
                    (future_volume - past_volume) / past_volume if past_volume else 0.0,
                    LOAD_DEAD_BAND,
                ),
            }
        )
        cursor += timedelta(days=EVAL_EVERY_DAYS)

    return rows_out


def auc(scores: list[float], labels: list[int]) -> float | None:
    pos = [s for s, y in zip(scores, labels, strict=True) if y == 1]
    neg = [s for s, y in zip(scores, labels, strict=True) if y == 0]
    if not pos or not neg:
        return None
    wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def summarize(rows: list[dict]) -> dict:
    usable = [r for r in rows if "error" not in r]
    if not usable:
        return {"evaluaciones": 0}

    committed = [r for r in usable if r["engine_direction"] in {"up", "stable", "down"}]

    def acc(pred: str, truth: str, subset: list[dict]) -> float | None:
        if not subset:
            return None
        return sum(1 for r in subset if r[pred] == r[truth]) / len(subset)

    def majority(truth: str) -> float:
        counts: dict[str, int] = defaultdict(int)
        for r in usable:
            counts[r[truth]] += 1
        return max(counts.values()) / len(usable)

    dist: dict[str, int] = defaultdict(int)
    perf_dist: dict[str, int] = defaultdict(int)
    for r in usable:
        dist[r["engine_direction"]] += 1
        perf_dist[r["perf_realized"]] += 1

    plateau_rows = [r for r in usable if r["plateau_p"] is not None]
    scores = [float(r["plateau_p"]) for r in plateau_rows]
    labels = [1 if r["perf_change"] <= 0 else 0 for r in plateau_rows]
    prevalence = (sum(labels) / len(labels)) if labels else None
    brier = (
        sum((s - y) ** 2 for s, y in zip(scores, labels, strict=True)) / len(scores)
        if scores
        else None
    )
    brier_base = (
        sum((prevalence - y) ** 2 for y in labels) / len(labels) if labels and prevalence else None
    )

    return {
        "evaluaciones": len(usable),
        "atletas": len({r["athlete"] for r in usable}),
        "errores_motor": len(rows) - len(usable),
        "distribucion_motor": dict(dist),
        "E1_volumen": {
            "acierto_motor": acc("engine_direction", "load_realized", usable),
            "acierto_motor_comprometido": acc("engine_direction", "load_realized", committed),
            "acierto_clase_mayoritaria": majority("load_realized"),
        },
        "E2_fuerza_1RM_estimado": {
            "distribucion_real": dict(perf_dist),
            "acierto_motor": acc("engine_direction", "perf_realized", usable),
            "acierto_motor_comprometido": acc("engine_direction", "perf_realized", committed),
            "n_comprometidas": len(committed),
            "acierto_clase_mayoritaria": majority("perf_realized"),
            "acierto_persistencia": acc("baseline_persistence", "perf_realized", usable),
            "plateau_brier": brier,
            "plateau_brier_baseline": brier_base,
            "plateau_auc_vs_sin_mejora": auc(scores, labels),
            "prevalencia_sin_mejora": prevalence,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    rows: list[dict] = []
    usados = 0
    for path in sorted(args.data_dir.glob("*.csv")):
        parsed = parse_log(path)
        if not parsed:
            continue
        produced = evaluate(path.stem[:16], parsed)
        if produced:
            usados += 1
        rows.extend(produced)

    report = summarize(rows)
    report["logs_usados"] = usados
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
