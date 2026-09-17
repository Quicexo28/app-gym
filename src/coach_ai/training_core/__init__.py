"""Phase 1: training_core.

This package implements:
- session schema (domain-level)
- session validation that returns issues (not hard decisions)
- base derived metrics
- individual normalization utilities

Design principle: return *issues + parameters*, not prescriptions.
"""

from .metrics import SessionMetrics, compute_session_metrics
from .muscle_groups import MUSCLE_GROUPS, canonicalize_muscle_group
from .naming import normalize_exercise_name
from .normalization import NormalizerParams, fit_normalizer, normalize_series, normalize_value
from .pipeline import AthleteSeries, PipelineResult, ProcessedSession, process_sessions
from .schema import Session, StrengthExercise, StrengthSet
from .types import Issue, Severity
from .validation import summarize_issues, validate_session, validate_sessions

__all__ = [
    "Issue",
    "MUSCLE_GROUPS",
    "NormalizerParams",
    "Session",
    "SessionMetrics",
    "Severity",
    "canonicalize_muscle_group",
    "compute_session_metrics",
    "fit_normalizer",
    "normalize_exercise_name",
    "normalize_series",
    "normalize_value",
    "summarize_issues",
    "validate_session",
    "validate_sessions",
    "StrengthExercise",
    "StrengthSet",
    "AthleteSeries",
    "PipelineResult",
    "ProcessedSession",
    "process_sessions",
]
