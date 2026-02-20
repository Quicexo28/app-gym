from __future__ import annotations

import copy
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    CycleAssignment,
    CycleAssignmentBlock,
    CycleBlockStatus,
    GamificationConfig,
    TrainingSession,
)


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
DEFAULT_TRILOGY_ACHIEVEMENT = "Trilogia basica desbloqueada"
DEFAULT_TRILOGY_MEDAL = "Basicos de Acero"


def default_gamification_config() -> dict[str, Any]:
    return {
        "streak_tiers": [_tier_to_payload(tier) for tier in STREAK_TIERS],
        "planning_days_tiers": [_tier_to_payload(tier) for tier in PLANNING_DAYS_TIERS],
        "lift_tiers": {
            lift_key: [_tier_to_payload(tier) for tier in tiers]
            for lift_key, tiers in LIFT_TIERS.items()
        },
        "trilogy_achievement": DEFAULT_TRILOGY_ACHIEVEMENT,
        "trilogy_medal": DEFAULT_TRILOGY_MEDAL,
    }


def normalize_gamification_config(payload: dict[str, Any] | None) -> dict[str, Any]:
    defaults = default_gamification_config()
    if not isinstance(payload, dict):
        return defaults

    normalized: dict[str, Any] = copy.deepcopy(defaults)

    normalized["streak_tiers"] = _normalize_tier_list(payload.get("streak_tiers"), defaults["streak_tiers"])
    normalized["planning_days_tiers"] = _normalize_tier_list(
        payload.get("planning_days_tiers"),
        defaults["planning_days_tiers"],
    )

    raw_lift_tiers = payload.get("lift_tiers")
    if isinstance(raw_lift_tiers, dict):
        lift_tiers: dict[str, list[dict[str, Any]]] = {}
        for lift_key in BASIC_LIFT_KEYS:
            lift_tiers[lift_key] = _normalize_tier_list(
                raw_lift_tiers.get(lift_key),
                defaults["lift_tiers"][lift_key],
            )
        normalized["lift_tiers"] = lift_tiers

    trilogy_achievement = _clean_text(payload.get("trilogy_achievement"), max_len=120)
    trilogy_medal = _clean_text(payload.get("trilogy_medal"), max_len=120)
    if trilogy_achievement:
        normalized["trilogy_achievement"] = trilogy_achievement
    if trilogy_medal:
        normalized["trilogy_medal"] = trilogy_medal

    return normalized


def get_gamification_config(db: Session) -> dict[str, Any]:
    row = db.execute(
        select(GamificationConfig).where(GamificationConfig.scope == "global")
    ).scalar_one_or_none()
    if row is None:
        return default_gamification_config()
    return normalize_gamification_config(row.config)


def upsert_gamification_config(
    db: Session,
    *,
    payload: dict[str, Any],
    updated_by_user_id,
) -> dict[str, Any]:
    normalized = normalize_gamification_config(payload)
    row = db.execute(
        select(GamificationConfig).where(GamificationConfig.scope == "global")
    ).scalar_one_or_none()
    if row is None:
        row = GamificationConfig(
            scope="global",
            config=normalized,
            updated_by_user_id=updated_by_user_id,
        )
        db.add(row)
    else:
        row.config = normalized
        row.updated_by_user_id = updated_by_user_id
    db.commit()
    db.refresh(row)
    return normalize_gamification_config(row.config)


def build_profile_gamification(db: Session, *, athlete_id: str) -> dict[str, Any]:
    config_payload = get_gamification_config(db)
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
        config_payload=config_payload,
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
    config_payload: dict[str, Any] | None = None,
) -> tuple[list[str], list[str], list[str]]:
    config = normalize_gamification_config(config_payload)
    streak_tiers = _tiers_from_payload(config["streak_tiers"])
    planning_days_tiers = _tiers_from_payload(config["planning_days_tiers"])
    lift_tiers = {
        lift_key: _tiers_from_payload(config["lift_tiers"][lift_key])
        for lift_key in BASIC_LIFT_KEYS
    }

    achievements: list[str] = []
    medals: list[str] = []
    next_targets: list[str] = []

    streak_tier = _highest_unlocked_tier(float(current_streak_days), streak_tiers)
    if streak_tier is not None:
        achievements.append(streak_tier.achievement)
        medals.append(streak_tier.medal)
    next_streak_tier = _next_tier(float(current_streak_days), streak_tiers)
    if next_streak_tier is not None:
        next_targets.append(
            f"Racha actual {current_streak_days} dias -> objetivo {int(next_streak_tier.threshold)} dias"
        )

    completed_days_tier = _highest_unlocked_tier(float(completed_days_total), planning_days_tiers)
    if completed_days_tier is not None:
        achievements.append(completed_days_tier.achievement)
        medals.append(completed_days_tier.medal)
    next_completed_days_tier = _next_tier(float(completed_days_total), planning_days_tiers)
    if next_completed_days_tier is not None:
        next_targets.append(
            f"Dias de plan completados {completed_days_total} -> objetivo {int(next_completed_days_tier.threshold)}"
        )

    for lift_key in BASIC_LIFT_KEYS:
        tiers = lift_tiers[lift_key]
        best_pr = lift_prs_kg.get(lift_key)
        current_value = float(best_pr) if best_pr is not None else 0.0
        tier = _highest_unlocked_tier(current_value, tiers)
        if tier is not None:
            achievements.append(tier.achievement)
            if best_pr is not None:
                achievements.append(f"{LIFT_LABELS[lift_key]}: PR {best_pr:g} kg")
            medals.append(tier.medal)

        next_tier = _next_tier(current_value, tiers)
        if next_tier is None:
            continue
        current_label = f"{best_pr:g} kg" if best_pr is not None else "sin PR"
        next_targets.append(
            f"{LIFT_LABELS[lift_key]}: {current_label} -> objetivo {next_tier.threshold:g} kg"
        )

    if all((lift_prs_kg.get(lift_key) or 0.0) >= lift_tiers[lift_key][0].threshold for lift_key in BASIC_LIFT_KEYS):
        achievements.append(str(config["trilogy_achievement"]))
        medals.append(str(config["trilogy_medal"]))

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


def _tier_to_payload(tier: RewardTier) -> dict[str, Any]:
    return {
        "threshold": float(tier.threshold),
        "achievement": tier.achievement,
        "medal": tier.medal,
    }


def _tiers_from_payload(payload: list[dict[str, Any]]) -> tuple[RewardTier, ...]:
    out: list[RewardTier] = []
    for item in payload:
        threshold = _to_non_negative_float(item.get("threshold"))
        achievement = _clean_text(item.get("achievement"), max_len=120)
        medal = _clean_text(item.get("medal"), max_len=120)
        if threshold is None or threshold <= 0:
            continue
        if not achievement or not medal:
            continue
        out.append(RewardTier(threshold=threshold, achievement=achievement, medal=medal))
    out.sort(key=lambda item: item.threshold)
    return tuple(out)


def _normalize_tier_list(raw: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return copy.deepcopy(fallback)

    out: list[dict[str, Any]] = []
    seen: set[tuple[float, str, str]] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        threshold = _to_non_negative_float(item.get("threshold"))
        achievement = _clean_text(item.get("achievement"), max_len=120)
        medal = _clean_text(item.get("medal"), max_len=120)
        if threshold is None or threshold <= 0:
            continue
        if not achievement or not medal:
            continue

        normalized = {
            "threshold": float(threshold),
            "achievement": achievement,
            "medal": medal,
        }
        dedupe_key = (
            normalized["threshold"],
            normalized["achievement"].lower(),
            normalized["medal"].lower(),
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        out.append(normalized)

    if not out:
        return copy.deepcopy(fallback)
    out.sort(key=lambda row: float(row["threshold"]))
    return out


def _clean_text(value: Any, *, max_len: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        return None
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip()
    return cleaned or None


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
