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
    """Validate a session and return issues.

    Philosophy:
    - Return *issues*, do not raise (unless the session isn't parseable).
    - Prefer WARN over ERROR when something is merely suspicious.
    - Do not auto-correct values here. If you want transformations, do them explicitly.

    This function enforces only generic, domain-agnostic rules.
    Sport-specific logic should live in later modules (or configurable rule layers).
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
            # Soft suspicious patterns (do not block)
            if rpe == 0:
                issues.append(
                    Issue(
                        severity=Severity.INFO,
                        code="rpe_zero",
                        message="rpe=0 is uncommon for a training session; ensure it's intentional.",
                        field="rpe",
                        value=rpe,
                    )
                )

    # start_time sanity checks (never ERROR: clocks/timezones vary)
    st = session.start_time
    if st.tzinfo is None or st.tzinfo.utcoffset(st) is None:
        issues.append(
            Issue(
                severity=Severity.WARN,
                code="start_time_naive",
                message=(
                    "start_time has no timezone info. Series ordering can be ambiguous across DST/timezones."
                ),
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
                    message="start_time is in the future (system clock mismatch or wrong date).",
                    field="start_time",
                    value=st.isoformat(),
                    meta={"now_utc": now.isoformat()},
                )
            )

    # modality (informational only)
    if session.modality is None or not str(session.modality).strip():
        issues.append(
            Issue(
                severity=Severity.INFO,
                code="modality_missing",
                message="modality not provided; comparisons across modalities may be less specific.",
                field="modality",
                value=session.modality,
            )
        )

    # external_load: numeric finite and non-negative
    for k, v in (session.external_load or {}).items():
        if not _is_finite_number(v):
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="external_load_not_finite",
                    message="external_load value is not a finite number and will be ignored in metrics.",
                    field=f"external_load.{k}",
                    value=v,
                )
            )
            continue
        fv = float(v)
        if fv < 0:
            issues.append(
                Issue(
                    severity=Severity.ERROR,
                    code="external_load_negative",
                    message="external_load values must be >= 0.",
                    field=f"external_load.{k}",
                    value=fv,
                )
            )

    return issues


def validate_sessions(sessions: Sequence[Session]) -> list[Issue]:
    """Validate a batch of sessions and return aggregated issues.

    Adds batch-level checks (e.g., duplicates) while keeping per-session issues.
    """

    issues: list[Issue] = []

    # Per-session issues
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

    # Duplicate checks: (athlete_id, start_time) collisions
    seen: dict[tuple[str, str], int] = {}
    for i, s in enumerate(sessions):
        key = (s.athlete_id, s.start_time.isoformat())
        if key in seen:
            j = seen[key]
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="duplicate_session_key",
                    message=(
                        "Two sessions share the same (athlete_id, start_time). "
                        "This might be a duplicate import."
                    ),
                    field=f"sessions[{i}]",
                    value={"athlete_id": s.athlete_id, "start_time": s.start_time.isoformat()},
                    meta={"first_index": j, "second_index": i},
                )
            )
        else:
            seen[key] = i

    return issues


def summarize_issues(issues: Iterable[Issue]) -> dict[str, int]:
    """Summarize issues by severity."""

    out = {Severity.ERROR.value: 0, Severity.WARN.value: 0, Severity.INFO.value: 0}
    for iss in issues:
        out[iss.severity.value] = out.get(iss.severity.value, 0) + 1
    return out
