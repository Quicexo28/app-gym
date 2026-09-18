"""Dose and compliance extracted from what the app already stores.

The app records, per session, more than the engine currently reads:

- `set.meta.completed`         -> was this prescribed set actually done
- `set.meta.effort_scale/value`-> RPE or RIR reported by the athlete
- `exercise.meta.target_reps_*`-> the rep target of the routine
- `exercise.meta.group`        -> muscle group
- `session.meta.wellness_signals` -> sleep / stress / sensations, 1-10

`training_core.metrics` only looks at `reps` and `load_kg`, so all of the above
is dropped. This module turns it into the predictors a dose-response model
needs: how much work was prescribed, how much was done, at what effort, in what
state.

Nothing here predicts anything: every number is a count, a ratio or a mean over
facts already recorded. That is deliberate -- the modelling layer sits on top.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet

from .types import BlockFeatures, ExerciseCompliance, SessionCompliance

# A set only counts as "hard" for dose purposes if it was actually completed and
# is not flagged as warm-up: warm-ups do not drive adaptation and would inflate
# any sets-per-week figure.
__all__ = ["block_features", "session_compliance", "split_blocks"]


def _as_float(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out and out not in (float("inf"), float("-inf")) else None


def _as_int(value: Any) -> int | None:
    number = _as_float(value)
    return int(number) if number is not None else None


def _set_completed(st: StrengthSet) -> bool:
    """Completed unless the app explicitly says otherwise.

    Sessions imported from elsewhere carry no `completed` flag; treating those
    as "not done" would report 0% compliance for every legacy session.
    """
    flag = st.meta.get("completed")
    if isinstance(flag, bool):
        return flag
    return True


def _set_effort_rpe(st: StrengthSet) -> float | None:
    """RPE of a set, converting RIR when that is the athlete's scale."""
    if st.rpe is not None:
        return _as_float(st.rpe)
    if st.rir is not None:
        rir = _as_float(st.rir)
        return None if rir is None else max(0.0, 10.0 - rir)

    scale = str(st.meta.get("effort_scale") or "").lower()
    value = _as_float(st.meta.get("effort_value"))
    if value is None:
        return None
    if scale == "rir":
        return max(0.0, 10.0 - value)
    if scale == "rpe":
        return value
    return None


def _exercise_compliance(exercise: StrengthExercise) -> ExerciseCompliance:
    target_min = _as_int(exercise.meta.get("target_reps_min"))
    target_max = _as_int(exercise.meta.get("target_reps_max"))

    sets_completed = 0
    reps_in_target = 0
    volume = 0.0
    top_load: float | None = None
    efforts: list[float] = []

    for st in exercise.sets:
        if st.is_warmup:
            continue
        if not _set_completed(st):
            continue
        load = _as_float(st.load_kg)
        if load is None or load < 0 or st.reps <= 0:
            continue

        sets_completed += 1
        volume += load * st.reps
        top_load = load if top_load is None else max(top_load, load)

        if target_min is not None and target_max is not None and target_min <= st.reps <= target_max:
            reps_in_target += 1

        effort = _set_effort_rpe(st)
        if effort is not None:
            efforts.append(effort)

    prescribed = sum(1 for st in exercise.sets if not st.is_warmup)
    group = exercise.meta.get("group")

    return ExerciseCompliance(
        name=exercise.name,
        group=str(group) if group else None,
        sets_prescribed=prescribed,
        sets_completed=sets_completed,
        reps_in_target=reps_in_target,
        target_reps_min=target_min,
        target_reps_max=target_max,
        volume_load_kg=volume,
        top_load_kg=top_load,
        mean_effort_rpe=(sum(efforts) / len(efforts)) if efforts else None,
    )


def _wellness(session: Session) -> tuple[float | None, float | None, float | None]:
    signals = session.meta.get("wellness_signals")
    if not isinstance(signals, dict):
        return (None, None, None)

    def score(key: str) -> float | None:
        block = signals.get(key)
        if isinstance(block, dict):
            return _as_float(block.get("score_1_10"))
        return _as_float(block)

    return (score("sleep"), score("stress"), score("sensations"))


def session_compliance(session: Session) -> SessionCompliance:
    """Turn one session into prescribed-vs-done counts, effort and wellness."""
    sleep, stress, sensations = _wellness(session)
    return SessionCompliance(
        athlete_id=session.athlete_id,
        start_time=session.start_time,
        exercises=[_exercise_compliance(ex) for ex in session.exercises],
        sleep_1_10=sleep,
        stress_1_10=stress,
        sensations_1_10=sensations,
        session_rpe=_as_float(session.rpe),
    )


def split_blocks(
    sessions: list[Session], *, block_days: int = 28
) -> list[tuple[datetime, datetime]]:
    """Consecutive windows of `block_days` covering the athlete's history.

    Blocks -- not single sessions -- are the unit a dose-response model needs:
    strength answers to weeks of accumulated work, not to yesterday.
    """
    if not sessions:
        return []
    ordered = sorted(sessions, key=lambda s: s.start_time)
    start = ordered[0].start_time
    last = ordered[-1].start_time
    blocks: list[tuple[datetime, datetime]] = []
    while start < last:
        end = start + timedelta(days=block_days)
        blocks.append((start, end))
        start = end
    return blocks


def block_features(
    sessions: list[Session],
    start: datetime,
    end: datetime,
    *,
    sessions_planned: int | None = None,
) -> BlockFeatures | None:
    """Aggregate one block into the predictors of a dose-response model.

    `sessions_planned` is optional: when the planning module knows how many
    sessions the block prescribed, session adherence can be computed; without
    it, only the within-session compliance is available.
    """
    in_block = [s for s in sessions if start <= s.start_time < end]
    if not in_block:
        return None

    athlete_id = in_block[0].athlete_id
    weeks = max((end - start).days / 7.0, 1e-9)

    compliances = [session_compliance(s) for s in in_block]

    hard_sets = 0
    by_group: dict[str, int] = defaultdict(int)
    prescribed_total = 0
    completed_total = 0
    reps_in_target_total = 0
    volume = 0.0
    efforts: list[float] = []

    for compliance in compliances:
        for exercise in compliance.exercises:
            hard_sets += exercise.sets_completed
            by_group[exercise.group or "sin_grupo"] += exercise.sets_completed
            prescribed_total += exercise.sets_prescribed
            completed_total += exercise.sets_completed
            reps_in_target_total += exercise.reps_in_target
            volume += exercise.volume_load_kg
            if exercise.mean_effort_rpe is not None:
                efforts.extend([exercise.mean_effort_rpe] * max(exercise.sets_completed, 1))

    def mean(values: list[float]) -> float | None:
        return (sum(values) / len(values)) if values else None

    sleeps = [c.sleep_1_10 for c in compliances if c.sleep_1_10 is not None]
    stresses = [c.stress_1_10 for c in compliances if c.stress_1_10 is not None]
    sensations = [c.sensations_1_10 for c in compliances if c.sensations_1_10 is not None]

    sessions_done = len(in_block)

    return BlockFeatures(
        athlete_id=athlete_id,
        start=start,
        end=end,
        weeks=weeks,
        sessions_done=sessions_done,
        sessions_planned=sessions_planned,
        sessions_per_week=sessions_done / weeks,
        hard_sets_per_week=hard_sets / weeks,
        hard_sets_per_week_by_group={g: n / weeks for g, n in sorted(by_group.items())},
        volume_load_kg=volume,
        set_completion_ratio=(completed_total / prescribed_total) if prescribed_total else None,
        reps_in_target_ratio=(reps_in_target_total / completed_total) if completed_total else None,
        mean_effort_rpe=mean(efforts),
        mean_sleep_1_10=mean(sleeps),
        mean_stress_1_10=mean(stresses),
        mean_sensations_1_10=mean(sensations),
        sessions_with_prescription=sum(1 for c in compliances if c.has_prescription),
    )
