"""Backtest del motor contra entrenos densos reales (GoldenCheetah OpenData).

A diferencia de `opl_backtest.py` (competencias separadas por meses), aqui cada
atleta trae cientos de sesiones dia a dia durante 1-4 anos, con metricas ya
calculadas por sesion. Es el regimen para el que esta pensado el motor.

Se evaluan dos cosas distintas, y conviene no mezclarlas:

E1 - carga futura: la direccion de tendencia que da el motor sobre la carga,
     contra la carga real de las 4 semanas siguientes. Ojo: la carga la elige el
     atleta, asi que acertar aqui es util pero no es "predecir progreso".

E2 - rendimiento futuro: el estado del motor en el dia t contra lo que hace el
     mejor 20 min de potencia (20mCP, proxy estandar de forma) en los 28 dias
     siguientes comparado con los 28 anteriores. Esto si es progreso.

Entrada al motor: cada sesion se pasa con su duracion y un RPE derivado del
Intensity Factor (IF x 10, acotado a 1-10), de modo que el motor calcula su
propia metrica `srpe_load` (carga interna = duracion x RPE), que es una medida
de carga estandar y no un invento de este script.

Uso:
    python scripts/backtest/gc_fetch.py --out /tmp/gc --athletes 25
    python scripts/backtest/gc_backtest.py /tmp/gc
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from coach_ai.e2e.runner import run_end_to_end
from coach_ai.e2e.types import EndToEndConfig
from coach_ai.training_core.schema import Session

MIN_SESSIONS_PREFIX = 60  # historial minimo antes de la primera prediccion
EVAL_EVERY_DAYS = 14  # cada cuanto se evalua dentro de la historia del atleta
WINDOW_DAYS = 28  # ventana de rendimiento (pasada y futura)
MIN_PERF_SAMPLES = 3  # mediciones de 20mCP minimas por ventana
DEAD_BAND = 0.02  # +-2% en 20mCP: por debajo, "estable"
LOAD_DEAD_BAND = 0.10  # +-10% en carga semanal: por debajo, "estable"


@dataclass(frozen=True, slots=True)
class Ride:
    date: datetime
    duration_min: float
    rpe: float
    tss: float
    cp20: float | None


def _f(value) -> float | None:
    """Las metricas vienen como string, o como [valor, peso]."""
    if value is None:
        return None
    if isinstance(value, list):
        value = value[0] if value else None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None  # descarta NaN


# Algun atleta escribio texto libre con comillas dentro de "sport", y el export
# de GoldenCheetah no las escapo: el JSON queda invalido. Se repara esa linea en
# vez de tirar al atleta entero.
_SPORT_LINE = re.compile(r'^(\s*"sport"\s*:\s*")(.*)("\s*,?)$')


def _repair_json(text: str) -> str:
    fixed: list[str] = []
    for line in text.splitlines():
        match = _SPORT_LINE.match(line)
        if match:
            head, body, tail = match.groups()
            line = head + body.replace('"', "'") + tail
        fixed.append(line)
    return "\n".join(fixed)


def read_athlete(zip_path: Path) -> list[Ride]:
    with zipfile.ZipFile(zip_path) as archive:
        names = [n for n in archive.namelist() if n.endswith(".json")]
        if not names:
            return []
        raw = archive.read(names[0]).decode("utf-8", "replace")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        try:
            payload = json.loads(_repair_json(raw))
        except json.JSONDecodeError:
            print(f"JSON invalido, atleta descartado: {zip_path.name}")
            return []

    rides: list[Ride] = []
    for entry in payload.get("RIDES", []):
        metrics = entry.get("METRICS") or {}
        try:
            date = datetime.strptime(entry["date"], "%Y/%m/%d %H:%M:%S UTC").replace(tzinfo=UTC)
        except (KeyError, ValueError):
            continue

        seconds = _f(metrics.get("workout_time")) or 0.0
        if seconds < 600:  # menos de 10 min: ruido, no entreno
            continue

        intensity = _f(metrics.get("coggan_if"))
        tss = _f(metrics.get("coggan_tss")) or 0.0
        duration_min = seconds / 60.0
        if intensity and intensity > 0:
            rpe = min(10.0, max(1.0, intensity * 10.0))
        elif tss > 0:
            # TSS = duracion_h x IF^2 x 100  ->  IF = sqrt(TSS / (100 x h))
            hours = duration_min / 60.0
            rpe = min(10.0, max(1.0, ((tss / (100.0 * hours)) ** 0.5) * 10.0)) if hours else 5.0
        else:
            continue

        cp20 = _f(metrics.get("20m_critical_power"))
        rides.append(
            Ride(date, duration_min, round(rpe, 1), tss, cp20 if cp20 and cp20 > 0 else None)
        )

    rides.sort(key=lambda r: r.date)
    return rides


def to_sessions(athlete_id: str, rides: list[Ride]) -> list[Session]:
    return [
        Session(
            athlete_id=athlete_id,
            start_time=ride.date,
            duration_min=ride.duration_min,
            rpe=ride.rpe,
            modality="endurance",
            source="goldencheetah-opendata",
        )
        for ride in rides
    ]


def window_best(rides: list[Ride], start: datetime, end: datetime) -> tuple[float | None, int]:
    values = [r.cp20 for r in rides if start < r.date <= end and r.cp20 is not None]
    return (max(values) if values else None, len(values))


def window_load(rides: list[Ride], start: datetime, end: datetime) -> float:
    return sum(r.duration_min * r.rpe for r in rides if start < r.date <= end)


def label(change: float, dead_band: float) -> str:
    if change > dead_band:
        return "up"
    if change < -dead_band:
        return "down"
    return "stable"


def evaluate_athlete(athlete_id: str, rides: list[Ride]) -> list[dict]:
    sessions = to_sessions(athlete_id, rides)
    rows: list[dict] = []
    if len(rides) < MIN_SESSIONS_PREFIX + 10:
        return rows

    start_day = rides[MIN_SESSIONS_PREFIX].date
    last_day = rides[-1].date - timedelta(days=WINDOW_DAYS)
    cursor = start_day

    while cursor <= last_day:
        prefix = [s for s, r in zip(sessions, rides, strict=True) if r.date <= cursor]
        if len(prefix) < MIN_SESSIONS_PREFIX:
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue

        past_best, past_n = window_best(rides, cursor - timedelta(days=WINDOW_DAYS), cursor)
        future_best, future_n = window_best(rides, cursor, cursor + timedelta(days=WINDOW_DAYS))
        if past_best is None or future_best is None:
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue
        if past_n < MIN_PERF_SAMPLES or future_n < MIN_PERF_SAMPLES:
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue

        prev_best, _ = window_best(
            rides, cursor - timedelta(days=2 * WINDOW_DAYS), cursor - timedelta(days=WINDOW_DAYS)
        )

        past_load = window_load(rides, cursor - timedelta(days=WINDOW_DAYS), cursor)
        future_load = window_load(rides, cursor, cursor + timedelta(days=WINDOW_DAYS))

        config = EndToEndConfig(athlete_id=athlete_id, metric_key="srpe_load", log_enabled=False)
        try:
            result = run_end_to_end(prefix, config=config)
        except Exception as err:
            rows.append({"athlete": athlete_id, "t": cursor.isoformat(), "error": str(err)})
            cursor += timedelta(days=EVAL_EVERY_DAYS)
            continue

        point = result.trend.points[-1] if result.trend and result.trend.points else None
        states = result.latents.points[-1].states if (result.latents and result.latents.points) else {}

        perf_change = (future_best - past_best) / past_best
        prev_change = ((past_best - prev_best) / prev_best) if prev_best else 0.0

        rows.append(
            {
                "athlete": athlete_id,
                "t": cursor.isoformat(),
                "engine_direction": str(point.direction) if point else "insufficient",
                "engine_confidence": float(point.confidence) if point else 0.0,
                "plateau_p": _f(states.get("plateau")),
                "fatigue_p": _f(states.get("fatigue")),
                "readiness_p": _f(states.get("readiness")),
                # E2 (rendimiento)
                "perf_realized": label(perf_change, DEAD_BAND),
                "perf_change": perf_change,
                "baseline_perf_stable": "stable",
                "baseline_perf_persistence": label(prev_change, DEAD_BAND),
                # E1 (carga)
                "load_realized": label(
                    (future_load - past_load) / past_load if past_load else 0.0, LOAD_DEAD_BAND
                ),
            }
        )
        cursor += timedelta(days=EVAL_EVERY_DAYS)

    return rows


def auc(scores: list[float], labels: list[int]) -> float | None:
    pos = [s for s, y in zip(scores, labels, strict=True) if y == 1]
    neg = [s for s, y in zip(scores, labels, strict=True) if y == 0]
    if not pos or not neg:
        return None
    wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def summarize(rows: list[dict]) -> dict:
    usable = [r for r in rows if "error" not in r]

    def acc(pred: str, truth: str, subset: list[dict] | None = None) -> float | None:
        data = usable if subset is None else subset
        if not data:
            return None
        return sum(1 for r in data if r[pred] == r[truth]) / len(data)

    def majority(truth: str) -> float | None:
        """Baseline mas duro: acertar siempre la clase mas frecuente."""
        if not usable:
            return None
        counts: dict[str, int] = defaultdict(int)
        for r in usable:
            counts[r[truth]] += 1
        return max(counts.values()) / len(usable)

    # `volatile` / `insufficient` no son una prediccion: el motor se abstiene.
    committed = [r for r in usable if r["engine_direction"] in {"up", "stable", "down"}]

    dist: dict[str, int] = defaultdict(int)
    perf_dist: dict[str, int] = defaultdict(int)
    load_dist: dict[str, int] = defaultdict(int)
    for r in usable:
        dist[r["engine_direction"]] += 1
        perf_dist[r["perf_realized"]] += 1
        load_dist[r["load_realized"]] += 1

    plateau_rows = [r for r in usable if r["plateau_p"] is not None]
    scores = [r["plateau_p"] for r in plateau_rows]
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
        "errores_motor": len(rows) - len(usable),
        "atletas": len({r["athlete"] for r in usable}),
        "distribucion_motor": dict(dist),
        "E1_carga": {
            "distribucion_real": dict(load_dist),
            "acierto_motor": acc("engine_direction", "load_realized"),
            "acierto_motor_solo_cuando_se_compromete": acc(
                "engine_direction", "load_realized", committed
            ),
            "acierto_clase_mayoritaria": majority("load_realized"),
        },
        "E2_rendimiento_20mCP": {
            "distribucion_real": dict(perf_dist),
            "acierto_motor": acc("engine_direction", "perf_realized"),
            "acierto_motor_solo_cuando_se_compromete": acc(
                "engine_direction", "perf_realized", committed
            ),
            "n_comprometidas": len(committed),
            "acierto_clase_mayoritaria": majority("perf_realized"),
            "acierto_siempre_estable": acc("baseline_perf_stable", "perf_realized"),
            "acierto_persistencia": acc("baseline_perf_persistence", "perf_realized"),
            "plateau_brier": brier,
            "plateau_brier_baseline": brier_base,
            "plateau_auc_vs_sin_mejora": auc(scores, labels),
            "prevalencia_sin_mejora": prevalence,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path, help="directorio con los zips de gc_fetch.py")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    rows: list[dict] = []
    for zip_path in sorted(args.data_dir.glob("*.zip")):
        rides = read_athlete(zip_path)
        if len(rides) < MIN_SESSIONS_PREFIX + 10:
            continue
        rows.extend(evaluate_athlete(zip_path.stem[:8], rides))

    report = summarize(rows)
    text = json.dumps(report, indent=2, ensure_ascii=False)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
