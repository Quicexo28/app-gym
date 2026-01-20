from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np

from coach_ai.latents.probability import sigmoid
from coach_ai.training_core import Session
from coach_ai.training_core.schema import StrengthExercise, StrengthSet

from .types import AthleteSimConfig, SimulatedTruthPoint


def _default_start_utc() -> datetime:
    # deterministic start that is timezone-aware (avoid validation WARNs)
    return datetime(2024, 1, 1, 10, 0, 0, tzinfo=UTC)


def _training_days(days: int, sessions_per_week: int, rng: np.random.Generator) -> list[int]:
    """Pick training days indices (0..days-1) with approximate frequency per week."""
    # approximate: pick sessions_per_week days out of each 7-day block
    out: list[int] = []
    for week_start in range(0, days, 7):
        week_days = list(range(week_start, min(week_start + 7, days)))
        k = min(sessions_per_week, len(week_days))
        chosen = rng.choice(week_days, size=k, replace=False)
        out.extend(sorted(int(x) for x in chosen))
    return sorted(out)


def _deload_multiplier(day_index: int, *, deload_every_weeks: int, deload_mult: float) -> float:
    if deload_every_weeks <= 0:
        return 1.0
    week = day_index // 7
    if (week + 1) % deload_every_weeks == 0:
        return deload_mult
    return 1.0


def simulate_athlete(
    cfg: AthleteSimConfig,
    *,
    rng: np.random.Generator,
    start_utc: datetime | None = None,
) -> tuple[list[Session], list[SimulatedTruthPoint]]:
    start = _default_start_utc() if start_utc is None else start_utc
    days = cfg.days

    train_days = _training_days(days, cfg.sessions_per_week, rng)
    sessions: list[Session] = []
    truth: list[SimulatedTruthPoint] = []

    # True fatigue: EWMA of (relative load - 1) (simple simulator truth)
    true_fatigue_raw = 0.0
    alpha_truth = 0.30

    # for plateau truth: last 4 points slope small
    vol_hist: list[float] = []

    for d in train_days:
        t = start + timedelta(days=d)

        week = d // 7
        mult_deload = _deload_multiplier(
            d, deload_every_weeks=cfg.deload_every_weeks, deload_mult=cfg.deload_multiplier
        )
        build_mult = (1.0 + cfg.progression_per_week * week) * mult_deload

        base = cfg.baseline_volume_kg * build_mult
        noise = float(rng.normal(0.0, cfg.volume_noise_cv))
        vol = base * max(0.3, 1.0 + noise)

        # Data quality perturbations
        missing_ex = rng.random() < cfg.missing_exercises_prob
        naming_noise = rng.random() < cfg.naming_noise_prob

        # Construct sets so that sum(load*reps) ≈ vol
        reps = cfg.reps_per_set
        sets = cfg.sets_per_session
        load_kg = vol / max(1.0, float(reps * sets))

        ex_name = "Bench Press"
        if naming_noise:
            ex_name = rng.choice(["Bench press", "BENCH", "BenchPress"]).item()

        exercises = []
        if not missing_ex:
            exercises = [
                StrengthExercise(
                    name=str(ex_name),
                    sets=[
                        StrengthSet(reps=int(reps), load_kg=float(load_kg))
                        for _ in range(int(sets))
                    ],
                )
            ]

        # Update truth fatigue with relative load (centered at baseline)
        rel = (vol / max(1e-6, cfg.baseline_volume_kg)) - 1.0
        true_fatigue_raw = (1 - alpha_truth) * true_fatigue_raw + alpha_truth * rel
        true_fatigue_p = sigmoid(true_fatigue_raw, k=2.5, x0=0.0)

        # Plateau truth: last 4 volumes nearly flat
        vol_hist.append(vol)
        plateau = 0
        if len(vol_hist) >= 4:
            w = vol_hist[-4:]
            slope = (w[-1] - w[0]) / max(1e-6, abs(w[0]))
            plateau = 1 if abs(slope) < 0.01 else 0

        # Session RPE (optional): increases with fatigue
        rpe = None
        if cfg.include_session_rpe:
            rpe = float(np.clip(cfg.rpe_base + cfg.rpe_fatigue_gain * true_fatigue_raw, 4.0, 10.0))

        s = Session(
            athlete_id=cfg.athlete_id,
            start_time=t,
            duration_min=60.0,
            rpe=rpe,
            modality="strength",
            exercises=exercises,
            source="simulator",
            meta={"sim_week": int(week), "sim_day": int(d)},
        )
        sessions.append(s)

        truth.append(
            SimulatedTruthPoint(
                athlete_id=cfg.athlete_id,
                t=t,
                volume_load_kg=None if missing_ex else float(vol),
                true_fatigue_raw=float(true_fatigue_raw),
                true_fatigue_p=float(true_fatigue_p),
                true_plateau_flag=int(plateau),
                meta={"missing_exercises": bool(missing_ex), "naming_noise": bool(naming_noise)},
            )
        )

    return sessions, truth


def simulate_population(
    athletes: list[AthleteSimConfig],
    *,
    seed: int = 42,
    start_utc: datetime | None = None,
) -> tuple[list[Session], list[SimulatedTruthPoint]]:
    rng = np.random.default_rng(seed)
    all_sessions: list[Session] = []
    all_truth: list[SimulatedTruthPoint] = []

    for cfg in athletes:
        s, t = simulate_athlete(cfg, rng=rng, start_utc=start_utc)
        all_sessions.extend(s)
        all_truth.extend(t)

    # mix ordering to ensure pipeline ordering works
    rng.shuffle(all_sessions)
    all_truth.sort(key=lambda x: (x.athlete_id, x.t))
    return all_sessions, all_truth
