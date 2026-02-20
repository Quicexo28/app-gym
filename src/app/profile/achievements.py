from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CycleAssignment, CycleAssignmentBlock, CycleBlockStatus, TrainingSession


BASIC_LIFT_KEYS = ("back_squat", "bench_press", "deadlift")

LIFT_LABELS: dict[str, str] = {
    "back_squat": "Sentadilla posterior libre",
    "bench_press": "Press banca plano",
    "deadlift": "Peso muerto convencional",
}


@dataclass(frozen=True, slots=True)
class RewardTier:
    threshold: float
    achievement: str
    medal: str


STREAK_TIERS: tuple[RewardTier, ...] = (
    RewardTier(3, "Racha inicial de 3 dias", "Racha de Bronce"),
    RewardTier(7, "Racha semanal completa", "Racha de Plata"),
    RewardTier(14, "Dos semanas en racha", "Racha de Oro"),
    RewardTier(30, "Mes completo en racha", "Racha de Titanio"),
)

PLANNING_DAYS_TIERS: tuple[RewardTier, ...] = (
    RewardTier(5, "5 dias de planificacion completados", "Planificador Bronce"),
    RewardTier(20, "20 dias de planificacion completados", "Planificador Plata"),
    RewardTier(50, "50 dias de planificacion completados", "Planificador Oro"),
    RewardTier(100, "100 dias de planificacion completados", "Planificador Titanio"),
)

LIFT_TIERS: dict[str, tuple[RewardTier, ...]] = {
    "back_squat": (
        RewardTier(40, "Sentadilla posterior 40 kg", "Sentadilla Bronce"),
        RewardTier(80, "Sentadilla posterior 80 kg", "Sentadilla Plata"),
        RewardTier(120, "Sentadilla posterior 120 kg", "Sentadilla Oro"),
        RewardTier(160, "Sentadilla posterior 160 kg", "Sentadilla Titanio"),
    ),
    "bench_press": (
        RewardTier(30, "Press banca 30 kg", "Banca Bronce"),
        RewardTier(60, "Press banca 60 kg", "Banca Plata"),
        RewardTier(90, "Press banca 90 kg", "Banca Oro"),
        RewardTier(120, "Press banca 120 kg", "Banca Titanio"),
    ),
    "deadlift": (
        RewardTier(60, "Peso muerto 60 kg", "Peso Muerto Bronce"),
        RewardTier(100, "Peso muerto 100 kg", "Peso Muerto Plata"),
        RewardTier(140, "Peso muerto 140 kg", "Peso Muerto Oro"),
        RewardTier(180, "Peso muerto 180 kg", "Peso Muerto Titanio"),
    ),
}


def build_profile_gamification(db: Session, *, athlete_id: str) -> dict[str, Any]:
    completed_days = _planning_completed_days(db, athlete_id=athlete_id)
    current_streak, longest_streak = compute_streak_metrics(
        completed_days,
        today=datetime.now(UTC).date(),
    )
    lift_prs = _basic_lifts_pr_kg(db, athlete_id=athlete_id)

    unlocked_achievements, unlocked_medals, next_targets = _build_reward_snapshot(
        completed_days_total=len(completed_days),
        current_streak_days=current_streak,
        lift_prs_kg=lift_prs,
    )

    return {
        "planning": {
            "completed_days_total": len(completed_days),
            "current_streak_days": current_streak,
            "longest_streak_days": longest_streak,
        },
        "basic_lifts_pr_kg": {
            "back_squat": lift_prs["back_squat"],
            "bench_press": lift_prs["bench_press"],
            "deadlift": lift_prs["deadlift"],
        },
        "unlocked_achievements": unlocked_achievements,
        "unlocked_medals": unlocked_medals,
        "next_targets": next_targets,
    }


def normalize_basic_lift_key(exercise_name: str) -> str | None:
    normalized = _normalize_text(exercise_name)
    if not normalized:
        return None

    tokens = set(normalized.split())
    if not tokens:
        return None

    is_back_squat = ("sentadilla" in tokens and ("posterior" in tokens or "trasera" in tokens)) or (
        "back" in tokens and "squat" in tokens
    )
    squat_excluded = {
        "front",
        "frontal",
        "smith",
        "hack",
        "goblet",
        "bulgara",
        "bulgarian",
        "safety",
        "zercher",
    }
    if is_back_squat and tokens.isdisjoint(squat_excluded):
        return "back_squat"

    is_bench_press = ("press" in tokens and "banca" in tokens) or ("bench" in tokens and "press" in tokens)
    bench_excluded = {
        "inclinado",
        "incline",
        "declinado",
        "decline",
        "mancuerna",
        "mancuernas",
        "dumbbell",
        "smith",
        "maquina",
        "machine",
        "cerrado",
        "close",
    }
    if is_bench_press and tokens.isdisjoint(bench_excluded):
        return "bench_press"

    is_deadlift = ("peso" in tokens and "muerto" in tokens) or ("deadlift" in tokens)
    deadlift_excluded = {
        "rumano",
        "romanian",
        "rdl",
        "sumo",
        "trap",
        "hex",
        "stiff",
        "snatch",
        "clean",
    }
    if is_deadlift and tokens.isdisjoint(deadlift_excluded):
        return "deadlift"

    return None


def compute_streak_metrics(completed_days: set[date], *, today: date) -> tuple[int, int]:
    if not completed_days:
        return 0, 0

    ordered_days = sorted(completed_days)
    longest_streak = 1
    running = 1
    for idx in range(1, len(ordered_days)):
        if ordered_days[idx] - ordered_days[idx - 1] == timedelta(days=1):
            running += 1
        else:
            running = 1
        if running > longest_streak:
            longest_streak = running

    anchor: date | None = None
    if today in completed_days:
        anchor = today
    elif (today - timedelta(days=1)) in completed_days:
        anchor = today - timedelta(days=1)

    if anchor is None:
        return 0, longest_streak

    current_streak = 0
    cursor = anchor
    while cursor in completed_days:
        current_streak += 1
        cursor -= timedelta(days=1)

    return current_streak, longest_streak


def _planning_completed_days(db: Session, *, athlete_id: str) -> set[date]:
    rows = db.execute(
        select(CycleAssignmentBlock.target_date, CycleAssignmentBlock.completed_at_utc)
        .join(CycleAssignment, CycleAssignmentBlock.assignment_id == CycleAssignment.id)
        .where(
            CycleAssignment.athlete_id == athlete_id,
            CycleAssignmentBlock.status == CycleBlockStatus.COMPLETED,
        )
    ).all()

    completed_days: set[date] = set()
    for target_date, completed_at in rows:
        if isinstance(target_date, date):
            completed_days.add(target_date)
            continue
        if isinstance(completed_at, datetime):
            completed_days.add(completed_at.date())
    return completed_days


def _basic_lifts_pr_kg(db: Session, *, athlete_id: str) -> dict[str, float | None]:
    rows = db.execute(
        select(TrainingSession.exercises).where(TrainingSession.athlete_id == athlete_id)
    ).scalars().all()

    prs: dict[str, float | None] = {
        "back_squat": None,
        "bench_press": None,
        "deadlift": None,
    }

    for session_exercises in rows:
        if not isinstance(session_exercises, list):
            continue

        for raw_exercise in session_exercises:
            if not isinstance(raw_exercise, dict):
                continue

            lift_key = normalize_basic_lift_key(str(raw_exercise.get("name") or ""))
            if lift_key is None:
                continue

            sets = raw_exercise.get("sets")
            if not isinstance(sets, list):
                continue

            for raw_set in sets:
                if not isinstance(raw_set, dict):
                    continue
                if bool(raw_set.get("is_warmup")):
                    continue

                reps = _to_non_negative_float(raw_set.get("reps"))
                load_kg = _to_non_negative_float(raw_set.get("load_kg"))
                if reps is None or reps <= 0:
                    continue
                if load_kg is None:
                    continue

                current = prs[lift_key]
                if current is None or load_kg > current:
                    prs[lift_key] = load_kg

    return {key: _round_kg(value) for key, value in prs.items()}


def _build_reward_snapshot(
    *,
    completed_days_total: int,
    current_streak_days: int,
    lift_prs_kg: dict[str, float | None],
) -> tuple[list[str], list[str], list[str]]:
    achievements: list[str] = []
    medals: list[str] = []
    next_targets: list[str] = []

    streak_tier = _highest_unlocked_tier(float(current_streak_days), STREAK_TIERS)
    if streak_tier is not None:
        achievements.append(streak_tier.achievement)
        medals.append(streak_tier.medal)
    next_streak_tier = _next_tier(float(current_streak_days), STREAK_TIERS)
    if next_streak_tier is not None:
        next_targets.append(
            f"Racha actual {current_streak_days} dias -> objetivo {int(next_streak_tier.threshold)} dias"
        )

    completed_days_tier = _highest_unlocked_tier(float(completed_days_total), PLANNING_DAYS_TIERS)
    if completed_days_tier is not None:
        achievements.append(completed_days_tier.achievement)
        medals.append(completed_days_tier.medal)
    next_completed_days_tier = _next_tier(float(completed_days_total), PLANNING_DAYS_TIERS)
    if next_completed_days_tier is not None:
        next_targets.append(
            f"Dias de plan completados {completed_days_total} -> objetivo {int(next_completed_days_tier.threshold)}"
        )

    for lift_key in BASIC_LIFT_KEYS:
        tiers = LIFT_TIERS[lift_key]
        best_pr = lift_prs_kg.get(lift_key)
        current_value = float(best_pr) if best_pr is not None else 0.0
        tier = _highest_unlocked_tier(current_value, tiers)
        if tier is not None:
            achievements.append(f"{LIFT_LABELS[lift_key]}: PR {best_pr:g} kg")
            medals.append(tier.medal)

        next_tier = _next_tier(current_value, tiers)
        if next_tier is None:
            continue
        current_label = f"{best_pr:g} kg" if best_pr is not None else "sin PR"
        next_targets.append(
            f"{LIFT_LABELS[lift_key]}: {current_label} -> objetivo {next_tier.threshold:g} kg"
        )

    if all((lift_prs_kg.get(lift_key) or 0.0) >= LIFT_TIERS[lift_key][0].threshold for lift_key in BASIC_LIFT_KEYS):
        achievements.append("Trilogia basica desbloqueada")
        medals.append("Basicos de Acero")

    return (
        _dedupe_texts(achievements),
        _dedupe_texts(medals),
        _dedupe_texts(next_targets),
    )


def _normalize_text(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    return " ".join(re.sub(r"[^a-z0-9]+", " ", ascii_value).split())


def _to_non_negative_float(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out < 0:
        return None
    return out


def _round_kg(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 1)


def _highest_unlocked_tier(value: float, tiers: tuple[RewardTier, ...]) -> RewardTier | None:
    best: RewardTier | None = None
    for tier in tiers:
        if value < tier.threshold:
            break
        best = tier
    return best


def _next_tier(value: float, tiers: tuple[RewardTier, ...]) -> RewardTier | None:
    for tier in tiers:
        if value < tier.threshold:
            return tier
    return None


def _dedupe_texts(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = " ".join(value.split()).strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out
