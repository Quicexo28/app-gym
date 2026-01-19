from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime

from .schema import Session
from .types import Issue, Severity


def _is_finite_number(x: object) -> bool:
    try:
        v = float(x)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return not (math.isnan(v) or math.isinf(v))


def validate_session(session: Session) -> list[Issue]:
    """Validate a gym session and return issues (no exceptions).

    Focus: hypertrophy/strength training (sets, reps, load_kg).
    """

    issues: list[Issue] = []

    # duration
    if not _is_finite_number(session.duration_min):
        issues.append(
            Issue(
                severity=Severity.ERROR,
                code="duration_not_finite",
                message="duration_min must be a finite number.",
                field="duration_min",
                value=session.duration_min,
            )
        )
    else:
        dur = float(session.duration_min)
        if dur <= 0:
            issues.append(
                Issue(
                    severity=Severity.ERROR,
                    code="duration_non_positive",
                    message="duration_min must be > 0 to represent a real session.",
                    field="duration_min",
                    value=dur,
                )
            )
        elif dur > 24 * 60:
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="duration_unusually_long",
                    message="duration_min is unusually long (> 24h). Check units or data source.",
                    field="duration_min",
                    value=dur,
                )
            )

    # rpe (optional)
    if session.rpe is None:
        issues.append(
            Issue(
                severity=Severity.WARN,
                code="rpe_missing",
                message="rpe is missing; internal load (sRPE) will be unavailable.",
                field="rpe",
                value=None,
            )
        )
    else:
        if not _is_finite_number(session.rpe):
            issues.append(
                Issue(
                    severity=Severity.ERROR,
                    code="rpe_not_finite",
                    message="rpe must be a finite number when provided.",
                    field="rpe",
                    value=session.rpe,
                )
            )
        else:
            rpe = float(session.rpe)
            if rpe < 0 or rpe > 10:
                issues.append(
                    Issue(
                        severity=Severity.ERROR,
                        code="rpe_out_of_range",
                        message="rpe must be within [0, 10].",
                        field="rpe",
                        value=rpe,
                    )
                )

    # start_time sanity checks
    st = session.start_time
    if st.tzinfo is None or st.tzinfo.utcoffset(st) is None:
        issues.append(
            Issue(
                severity=Severity.WARN,
                code="start_time_naive",
                message="start_time has no timezone info; ordering can be ambiguous across timezones.",
                field="start_time",
                value=st.isoformat(),
            )
        )
    else:
        now = datetime.now(UTC)
        st_utc = st.astimezone(UTC)
        if st_utc > now:
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="start_time_in_future",
                    message="start_time is in the future (clock mismatch or wrong date).",
                    field="start_time",
                    value=st.isoformat(),
                    meta={"now_utc": now.isoformat()},
                )
            )

    # modality informational
    if session.modality is None or not str(session.modality).strip():
        issues.append(
            Issue(
                severity=Severity.INFO,
                code="modality_missing",
                message="modality not provided; keeping default assumptions may be less specific.",
                field="modality",
                value=session.modality,
            )
        )

    # Exercises/sets validation (gym-specific)
    if not session.exercises:
        issues.append(
            Issue(
                severity=Severity.WARN,
                code="exercises_missing",
                message="No exercises provided; external load (volume) metrics will be unavailable.",
                field="exercises",
                value=[],
            )
        )
        return issues

    for ex_i, ex in enumerate(session.exercises):
        ex_field = f"exercises[{ex_i}]"

        if not ex.name.strip():
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="exercise_name_empty",
                    message="Exercise name is empty; grouping/aggregation becomes unreliable.",
                    field=f"{ex_field}.name",
                    value=ex.name,
                )
            )

        if not ex.sets:
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="exercise_sets_empty",
                    message="Exercise has no sets; volume metrics will ignore it.",
                    field=f"{ex_field}.sets",
                    value=[],
                )
            )
            continue

        for set_i, st_ in enumerate(ex.sets):
            set_field = f"{ex_field}.sets[{set_i}]"

            # reps
            if not isinstance(st_.reps, int):
                issues.append(
                    Issue(
                        severity=Severity.ERROR,
                        code="reps_not_int",
                        message="reps must be an integer.",
                        field=f"{set_field}.reps",
                        value=st_.reps,
                    )
                )
            else:
                if st_.reps <= 0:
                    issues.append(
                        Issue(
                            severity=Severity.ERROR,
                            code="reps_non_positive",
                            message="reps must be > 0.",
                            field=f"{set_field}.reps",
                            value=st_.reps,
                        )
                    )
                elif st_.reps > 200:
                    issues.append(
                        Issue(
                            severity=Severity.WARN,
                            code="reps_unusually_high",
                            message="reps is unusually high (>200). Check units or entry.",
                            field=f"{set_field}.reps",
                            value=st_.reps,
                        )
                    )

            # load_kg
            if not _is_finite_number(st_.load_kg):
                issues.append(
                    Issue(
                        severity=Severity.ERROR,
                        code="load_not_finite",
                        message="load_kg must be a finite number.",
                        field=f"{set_field}.load_kg",
                        value=st_.load_kg,
                    )
                )
            else:
                load = float(st_.load_kg)
                if load < 0:
                    issues.append(
                        Issue(
                            severity=Severity.ERROR,
                            code="load_negative",
                            message="load_kg must be >= 0.",
                            field=f"{set_field}.load_kg",
                            value=load,
                        )
                    )

            # rir/rpe optional sanity (WARN only)
            if st_.rir is not None:
                if not _is_finite_number(st_.rir):
                    issues.append(
                        Issue(
                            severity=Severity.WARN,
                            code="rir_not_finite",
                            message="rir is not finite; it will be ignored.",
                            field=f"{set_field}.rir",
                            value=st_.rir,
                        )
                    )
                else:
                    rir = float(st_.rir)
                    if rir < 0 or rir > 10:
                        issues.append(
                            Issue(
                                severity=Severity.WARN,
                                code="rir_out_of_range",
                                message="rir outside [0,10]; check entry.",
                                field=f"{set_field}.rir",
                                value=rir,
                            )
                        )

            if st_.rpe is not None:
                if not _is_finite_number(st_.rpe):
                    issues.append(
                        Issue(
                            severity=Severity.WARN,
                            code="set_rpe_not_finite",
                            message="set rpe is not finite; it will be ignored.",
                            field=f"{set_field}.rpe",
                            value=st_.rpe,
                        )
                    )
                else:
                    srpe = float(st_.rpe)
                    if srpe < 0 or srpe > 10:
                        issues.append(
                            Issue(
                                severity=Severity.WARN,
                                code="set_rpe_out_of_range",
                                message="set rpe outside [0,10]; check entry.",
                                field=f"{set_field}.rpe",
                                value=srpe,
                            )
                        )

    return issues


def validate_sessions(sessions: Sequence[Session]) -> list[Issue]:
    """Batch validation (adds duplicate checks)."""

    issues: list[Issue] = []

    for i, s in enumerate(sessions):
        for iss in validate_session(s):
            issues.append(
                Issue(
                    severity=iss.severity,
                    code=iss.code,
                    message=iss.message,
                    field=(f"sessions[{i}].{iss.field}" if iss.field else f"sessions[{i}]"),
                    value=iss.value,
                    meta=iss.meta,
                )
            )

    seen: dict[tuple[str, str], int] = {}
    for i, s in enumerate(sessions):
        key = (s.athlete_id, s.start_time.isoformat())
        if key in seen:
            j = seen[key]
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="duplicate_session_key",
                    message="Two sessions share the same (athlete_id, start_time). Might be duplicate import.",
                    field=f"sessions[{i}]",
                    value={"athlete_id": s.athlete_id, "start_time": s.start_time.isoformat()},
                    meta={"first_index": j, "second_index": i},
                )
            )
        else:
            seen[key] = i

    return issues


def summarize_issues(issues: Iterable[Issue]) -> dict[str, int]:
    out = {Severity.ERROR.value: 0, Severity.WARN.value: 0, Severity.INFO.value: 0}
    for iss in issues:
        out[iss.severity.value] = out.get(iss.severity.value, 0) + 1
    return out
