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
    BodyMeasurement,
    CycleAssignment,
    CycleAssignmentBlock,
    CycleBlockStatus,
    GamificationConfig,
    TrainingSession,
)


BASIC_LIFT_KEYS = ("back_squat", "bench_press", "deadlift")
STREAK_GAP_TOLERANCE_DAYS_DEFAULT = 7
STREAK_GAP_TOLERANCE_DAYS_MAX = 14
MAX_EMBLEM_PNG_LENGTH = 350_000

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
    emblem_png: str | None = None


@dataclass(frozen=True, slots=True)
class ShowcaseItem:
    title: str
    emblem_png: str | None = None


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

RELATIVE_STRENGTH_TIERS: dict[str, tuple[RewardTier, ...]] = {
    "back_squat": (
        RewardTier(0.8, "Sentadilla relativa 0.8x BW", "Sentadilla Relativa Bronce"),
        RewardTier(1.1, "Sentadilla relativa 1.1x BW", "Sentadilla Relativa Plata"),
        RewardTier(1.4, "Sentadilla relativa 1.4x BW", "Sentadilla Relativa Oro"),
        RewardTier(1.7, "Sentadilla relativa 1.7x BW", "Sentadilla Relativa Titanio"),
    ),
    "bench_press": (
        RewardTier(0.6, "Banca relativa 0.6x BW", "Banca Relativa Bronce"),
        RewardTier(0.8, "Banca relativa 0.8x BW", "Banca Relativa Plata"),
        RewardTier(1.0, "Banca relativa 1.0x BW", "Banca Relativa Oro"),
        RewardTier(1.2, "Banca relativa 1.2x BW", "Banca Relativa Titanio"),
    ),
    "deadlift": (
        RewardTier(1.0, "Peso muerto relativo 1.0x BW", "Peso Muerto Relativo Bronce"),
        RewardTier(1.4, "Peso muerto relativo 1.4x BW", "Peso Muerto Relativo Plata"),
        RewardTier(1.8, "Peso muerto relativo 1.8x BW", "Peso Muerto Relativo Oro"),
        RewardTier(2.2, "Peso muerto relativo 2.2x BW", "Peso Muerto Relativo Titanio"),
    ),
}

DEFAULT_TRILOGY_ACHIEVEMENT = "Trilogia basica desbloqueada"
DEFAULT_TRILOGY_MEDAL = "Basicos de Acero"


def default_gamification_config() -> dict[str, Any]:
    return {
        "streak_gap_tolerance_days": STREAK_GAP_TOLERANCE_DAYS_DEFAULT,
        "streak_tiers": [_tier_to_payload(tier) for tier in STREAK_TIERS],
        "planning_days_tiers": [_tier_to_payload(tier) for tier in PLANNING_DAYS_TIERS],
        "lift_tiers": {
            lift_key: [_tier_to_payload(tier) for tier in tiers]
            for lift_key, tiers in LIFT_TIERS.items()
        },
        "relative_strength_tiers": {
            lift_key: [_tier_to_payload(tier) for tier in tiers]
            for lift_key, tiers in RELATIVE_STRENGTH_TIERS.items()
        },
        "trilogy_achievement": DEFAULT_TRILOGY_ACHIEVEMENT,
        "trilogy_medal": DEFAULT_TRILOGY_MEDAL,
        "trilogy_emblem_png": None,
    }


def normalize_gamification_config(payload: dict[str, Any] | None) -> dict[str, Any]:
    defaults = default_gamification_config()
    if not isinstance(payload, dict):
        return defaults

    normalized: dict[str, Any] = copy.deepcopy(defaults)

    normalized["streak_gap_tolerance_days"] = _normalize_positive_int(
        payload.get("streak_gap_tolerance_days"),
        fallback=defaults["streak_gap_tolerance_days"],
        min_value=1,
        max_value=STREAK_GAP_TOLERANCE_DAYS_MAX,
    )

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

    raw_relative_tiers = payload.get("relative_strength_tiers")
    if isinstance(raw_relative_tiers, dict):
        relative_tiers: dict[str, list[dict[str, Any]]] = {}
        for lift_key in BASIC_LIFT_KEYS:
            relative_tiers[lift_key] = _normalize_tier_list(
                raw_relative_tiers.get(lift_key),
                defaults["relative_strength_tiers"][lift_key],
            )
        normalized["relative_strength_tiers"] = relative_tiers

    trilogy_achievement = _clean_text(payload.get("trilogy_achievement"), max_len=120)
    trilogy_medal = _clean_text(payload.get("trilogy_medal"), max_len=120)
    if trilogy_achievement:
        normalized["trilogy_achievement"] = trilogy_achievement
    if trilogy_medal:
        normalized["trilogy_medal"] = trilogy_medal
    if "trilogy_emblem_png" in payload:
        normalized["trilogy_emblem_png"] = _clean_emblem_png(payload.get("trilogy_emblem_png"))

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
    streak_gap_tolerance_days = _normalize_positive_int(
        config_payload.get("streak_gap_tolerance_days"),
        fallback=STREAK_GAP_TOLERANCE_DAYS_DEFAULT,
        min_value=1,
        max_value=STREAK_GAP_TOLERANCE_DAYS_MAX,
    )

    completed_days = _planning_completed_days(db, athlete_id=athlete_id)
    training_days = _training_session_days(db, athlete_id=athlete_id)
    current_streak, longest_streak = compute_streak_metrics(
        training_days,
        today=datetime.now(UTC).date(),
        gap_tolerance_days=streak_gap_tolerance_days,
    )
    latest_training_day = max(training_days) if training_days else None
    lift_prs = _basic_lifts_pr_kg(db, athlete_id=athlete_id)
    body_weight_kg = _latest_body_weight_kg(db, athlete_id=athlete_id)
    relative_strength_ratios = _relative_strength_ratios(
        lift_prs_kg=lift_prs,
        body_weight_kg=body_weight_kg,
    )

    showcase_achievements, showcase_medals, next_targets = _build_showcase_snapshot(
        completed_days_total=len(completed_days),
        current_streak_days=current_streak,
        streak_gap_tolerance_days=streak_gap_tolerance_days,
        lift_prs_kg=lift_prs,
        relative_strength_ratios=relative_strength_ratios,
        body_weight_kg=body_weight_kg,
        config_payload=config_payload,
    )
    unlocked_achievements = [item.title for item in showcase_achievements]
    unlocked_medals = [item.title for item in showcase_medals]

    return {
        "planning": {
            "completed_days_total": len(completed_days),
            "current_streak_days": current_streak,
            "longest_streak_days": longest_streak,
            "streak_gap_tolerance_days": streak_gap_tolerance_days,
            "last_training_day": latest_training_day.isoformat() if latest_training_day else None,
        },
        "basic_lifts_pr_kg": {
            "back_squat": lift_prs["back_squat"],
            "bench_press": lift_prs["bench_press"],
            "deadlift": lift_prs["deadlift"],
        },
        "relative_strength": {
            "body_weight_kg": body_weight_kg,
            "back_squat": relative_strength_ratios["back_squat"],
            "bench_press": relative_strength_ratios["bench_press"],
            "deadlift": relative_strength_ratios["deadlift"],
        },
        "showcase": {
            "achievements": [
                {"title": item.title, "emblem_png": item.emblem_png}
                for item in showcase_achievements
            ],
            "medals": [
                {"title": item.title, "emblem_png": item.emblem_png}
                for item in showcase_medals
            ],
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


def compute_streak_metrics(
    completed_days: set[date],
    *,
    today: date,
    gap_tolerance_days: int = 1,
) -> tuple[int, int]:
    if not completed_days:
        return 0, 0

    tolerance = max(1, int(gap_tolerance_days))
    ordered_days = sorted(completed_days)
    longest_streak = 1
    running = 1
    for idx in range(1, len(ordered_days)):
        if ordered_days[idx] - ordered_days[idx - 1] <= timedelta(days=tolerance):
            running += 1
        else:
            running = 1
        if running > longest_streak:
            longest_streak = running

    latest_day = ordered_days[-1]
    if (today - latest_day) > timedelta(days=tolerance):
        return 0, longest_streak

    current_streak = 1
    for idx in range(len(ordered_days) - 1, 0, -1):
        if ordered_days[idx] - ordered_days[idx - 1] <= timedelta(days=tolerance):
            current_streak += 1
            continue
        break
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


def _training_session_days(db: Session, *, athlete_id: str) -> set[date]:
    rows = db.execute(
        select(TrainingSession.start_time).where(TrainingSession.athlete_id == athlete_id)
    ).scalars().all()

    out: set[date] = set()
    for start_time in rows:
        if isinstance(start_time, datetime):
            out.add(start_time.date())
    return out


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


def _latest_body_weight_kg(db: Session, *, athlete_id: str) -> float | None:
    value = db.execute(
        select(BodyMeasurement.weight_kg)
        .where(
            BodyMeasurement.athlete_id == athlete_id,
            BodyMeasurement.weight_kg.isnot(None),
            BodyMeasurement.weight_kg > 0,
        )
        .order_by(
            BodyMeasurement.measured_at.desc(),
            BodyMeasurement.created_at_utc.desc(),
        )
        .limit(1)
    ).scalar_one_or_none()
    return _round_kg(_to_non_negative_float(value))


def _relative_strength_ratios(
    *,
    lift_prs_kg: dict[str, float | None],
    body_weight_kg: float | None,
) -> dict[str, float | None]:
    if body_weight_kg is None or body_weight_kg <= 0:
        return {lift_key: None for lift_key in BASIC_LIFT_KEYS}

    out: dict[str, float | None] = {}
    for lift_key in BASIC_LIFT_KEYS:
        best_pr = lift_prs_kg.get(lift_key)
        if best_pr is None or best_pr <= 0:
            out[lift_key] = None
            continue
        out[lift_key] = _round_ratio(best_pr / body_weight_kg)
    return out


def _build_reward_snapshot(
    *,
    completed_days_total: int,
    current_streak_days: int,
    streak_gap_tolerance_days: int = STREAK_GAP_TOLERANCE_DAYS_DEFAULT,
    lift_prs_kg: dict[str, float | None],
    relative_strength_ratios: dict[str, float | None] | None = None,
    body_weight_kg: float | None = None,
    config_payload: dict[str, Any] | None = None,
) -> tuple[list[str], list[str], list[str]]:
    if relative_strength_ratios is None:
        relative_strength_ratios = _relative_strength_ratios(
            lift_prs_kg=lift_prs_kg,
            body_weight_kg=body_weight_kg,
        )
    achievements, medals, next_targets = _build_showcase_snapshot(
        completed_days_total=completed_days_total,
        current_streak_days=current_streak_days,
        streak_gap_tolerance_days=streak_gap_tolerance_days,
        lift_prs_kg=lift_prs_kg,
        relative_strength_ratios=relative_strength_ratios,
        body_weight_kg=body_weight_kg,
        config_payload=config_payload,
    )
    return (
        [item.title for item in achievements],
        [item.title for item in medals],
        next_targets,
    )


def _build_showcase_snapshot(
    *,
    completed_days_total: int,
    current_streak_days: int,
    streak_gap_tolerance_days: int,
    lift_prs_kg: dict[str, float | None],
    relative_strength_ratios: dict[str, float | None],
    body_weight_kg: float | None,
    config_payload: dict[str, Any] | None = None,
) -> tuple[list[ShowcaseItem], list[ShowcaseItem], list[str]]:
    config = normalize_gamification_config(config_payload)
    streak_tiers = _tiers_from_payload(config["streak_tiers"])
    planning_days_tiers = _tiers_from_payload(config["planning_days_tiers"])
    lift_tiers = {
        lift_key: _tiers_from_payload(config["lift_tiers"][lift_key])
        for lift_key in BASIC_LIFT_KEYS
    }
    relative_strength_tiers = {
        lift_key: _tiers_from_payload(config["relative_strength_tiers"][lift_key])
        for lift_key in BASIC_LIFT_KEYS
    }

    achievements: list[ShowcaseItem] = []
    medals: list[ShowcaseItem] = []
    next_targets: list[str] = []

    streak_tier = _highest_unlocked_tier(float(current_streak_days), streak_tiers)
    if streak_tier is not None:
        achievements.append(
            ShowcaseItem(
                title=streak_tier.achievement,
                emblem_png=streak_tier.emblem_png,
            )
        )
        medals.append(
            ShowcaseItem(
                title=streak_tier.medal,
                emblem_png=streak_tier.emblem_png,
            )
        )
    next_streak_tier = _next_tier(float(current_streak_days), streak_tiers)
    if next_streak_tier is not None:
        next_targets.append(
            (
                f"Racha activa {current_streak_days} entrenos "
                f"(gap <= {int(streak_gap_tolerance_days)} dias) "
                f"-> objetivo {int(next_streak_tier.threshold)} dias"
            )
        )

    completed_days_tier = _highest_unlocked_tier(float(completed_days_total), planning_days_tiers)
    if completed_days_tier is not None:
        achievements.append(
            ShowcaseItem(
                title=completed_days_tier.achievement,
                emblem_png=completed_days_tier.emblem_png,
            )
        )
        medals.append(
            ShowcaseItem(
                title=completed_days_tier.medal,
                emblem_png=completed_days_tier.emblem_png,
            )
        )
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
            achievements.append(
                ShowcaseItem(
                    title=tier.achievement,
                    emblem_png=tier.emblem_png,
                )
            )
            if best_pr is not None:
                achievements.append(
                    ShowcaseItem(
                        title=f"{LIFT_LABELS[lift_key]}: PR {best_pr:g} kg",
                        emblem_png=None,
                    )
                )
            medals.append(
                ShowcaseItem(
                    title=tier.medal,
                    emblem_png=tier.emblem_png,
                )
            )

        next_tier = _next_tier(current_value, tiers)
        if next_tier is None:
            continue
        current_label = f"{best_pr:g} kg" if best_pr is not None else "sin PR"
        next_targets.append(
            f"{LIFT_LABELS[lift_key]}: {current_label} -> objetivo {next_tier.threshold:g} kg"
        )

    if body_weight_kg is None or body_weight_kg <= 0:
        next_targets.append("Registra un peso corporal reciente para activar logros de fuerza relativa.")
    else:
        for lift_key in BASIC_LIFT_KEYS:
            tiers = relative_strength_tiers[lift_key]
            current_ratio = relative_strength_ratios.get(lift_key)
            current_value = float(current_ratio) if current_ratio is not None else 0.0
            tier = _highest_unlocked_tier(current_value, tiers)
            if tier is not None:
                achievements.append(
                    ShowcaseItem(
                        title=tier.achievement,
                        emblem_png=tier.emblem_png,
                    )
                )
                medals.append(
                    ShowcaseItem(
                        title=tier.medal,
                        emblem_png=tier.emblem_png,
                    )
                )

            next_tier = _next_tier(current_value, tiers)
            if next_tier is None:
                continue
            current_label = f"{current_ratio:g}x BW" if current_ratio is not None else "sin PR"
            next_targets.append(
                (
                    f"{LIFT_LABELS[lift_key]} fuerza relativa: {current_label} "
                    f"-> objetivo {next_tier.threshold:g}x BW"
                )
            )

    if _is_trilogy_unlocked(lift_prs_kg=lift_prs_kg, lift_tiers=lift_tiers):
        trilogy_emblem_png = _clean_emblem_png(config.get("trilogy_emblem_png"))
        achievements.append(
            ShowcaseItem(
                title=str(config["trilogy_achievement"]),
                emblem_png=trilogy_emblem_png,
            )
        )
        medals.append(
            ShowcaseItem(
                title=str(config["trilogy_medal"]),
                emblem_png=trilogy_emblem_png,
            )
        )

    return (
        _dedupe_showcase(achievements),
        _dedupe_showcase(medals),
        _dedupe_texts(next_targets),
    )


def _is_trilogy_unlocked(
    *,
    lift_prs_kg: dict[str, float | None],
    lift_tiers: dict[str, tuple[RewardTier, ...]],
) -> bool:
    for lift_key in BASIC_LIFT_KEYS:
        tiers = lift_tiers.get(lift_key) or ()
        if not tiers:
            return False
        first_threshold = tiers[0].threshold
        if (lift_prs_kg.get(lift_key) or 0.0) < first_threshold:
            return False
    return True


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


def _round_ratio(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 2)


def _tier_to_payload(tier: RewardTier) -> dict[str, Any]:
    return {
        "threshold": float(tier.threshold),
        "achievement": tier.achievement,
        "medal": tier.medal,
        "emblem_png": tier.emblem_png,
    }


def _tiers_from_payload(payload: list[dict[str, Any]]) -> tuple[RewardTier, ...]:
    out: list[RewardTier] = []
    for item in payload:
        threshold = _to_non_negative_float(item.get("threshold"))
        achievement = _clean_text(item.get("achievement"), max_len=120)
        medal = _clean_text(item.get("medal"), max_len=120)
        emblem_png = _clean_emblem_png(item.get("emblem_png"))
        if threshold is None or threshold <= 0:
            continue
        if not achievement or not medal:
            continue
        out.append(
            RewardTier(
                threshold=threshold,
                achievement=achievement,
                medal=medal,
                emblem_png=emblem_png,
            )
        )
    out.sort(key=lambda item: item.threshold)
    return tuple(out)


def _normalize_tier_list(raw: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return copy.deepcopy(fallback)

    out: list[dict[str, Any]] = []
    seen: set[tuple[float, str, str, str]] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        threshold = _to_non_negative_float(item.get("threshold"))
        achievement = _clean_text(item.get("achievement"), max_len=120)
        medal = _clean_text(item.get("medal"), max_len=120)
        emblem_png = _clean_emblem_png(item.get("emblem_png"))
        if threshold is None or threshold <= 0:
            continue
        if not achievement or not medal:
            continue

        normalized = {
            "threshold": float(threshold),
            "achievement": achievement,
            "medal": medal,
            "emblem_png": emblem_png,
        }
        dedupe_key = (
            normalized["threshold"],
            normalized["achievement"].lower(),
            normalized["medal"].lower(),
            (normalized["emblem_png"] or "").lower(),
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


def _clean_emblem_png(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > MAX_EMBLEM_PNG_LENGTH:
        return None

    lowered = cleaned.lower()
    if lowered.startswith("data:image/png;base64,"):
        return cleaned

    if lowered.startswith("http://") or lowered.startswith("https://") or lowered.startswith("/"):
        path = lowered.split("?", 1)[0].split("#", 1)[0]
        if path.endswith(".png"):
            return cleaned

    return None


def _normalize_positive_int(
    value: Any,
    *,
    fallback: int,
    min_value: int,
    max_value: int,
) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return fallback
    if normalized < min_value:
        return min_value
    if normalized > max_value:
        return max_value
    return normalized


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


def _dedupe_showcase(values: list[ShowcaseItem]) -> list[ShowcaseItem]:
    out: list[ShowcaseItem] = []
    seen: dict[str, int] = {}
    for value in values:
        title = " ".join(value.title.split()).strip()
        if not title:
            continue
        emblem_png = _clean_emblem_png(value.emblem_png)
        key = title.lower()
        if key in seen:
            existing_idx = seen[key]
            existing = out[existing_idx]
            if existing.emblem_png is None and emblem_png is not None:
                out[existing_idx] = ShowcaseItem(title=existing.title, emblem_png=emblem_png)
            continue
        seen[key] = len(out)
        out.append(ShowcaseItem(title=title, emblem_png=emblem_png))
    return out
