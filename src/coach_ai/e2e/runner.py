from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from coach_ai.latents import compute_latent_states
from coach_ai.suggestions import suggest_scenarios
from coach_ai.training_core import Session
from coach_ai.training_core.pipeline import AthleteSeries, PipelineResult, process_sessions
from coach_ai.training_core.types import Issue, Severity
from coach_ai.trends import compute_trends

from .decision_log import DecisionLogEntry, summarize_issues_for_log, write_jsonl
from .types import EndToEndConfig, EndToEndResult
from .versioning import ENGINE_VERSION, fingerprint_config


def _now_utc() -> datetime:
    return datetime.now(UTC)


def run_end_to_end(
    sessions: list[Session],
    *,
    config: EndToEndConfig,
) -> EndToEndResult:
    """Phase 5 end-to-end runner.

    Steps (fixed order):
      1) training_core.process_sessions
      2) select AthleteSeries
      3) trends.compute_trends
      4) latents.compute_latent_states
      5) suggestions.suggest_scenarios
      6) logging + version snapshot
    """
    run_id = str(uuid4())
    now = _now_utc()

    issues: list[Issue] = []

    # Snapshot config & versioning
    cfg_dict: dict[str, Any] = asdict(config)
    cfg_fp = fingerprint_config(cfg_dict)

    # 1) training_core
    tc: PipelineResult | None = None
    athlete_series: AthleteSeries | None = None
    trend = None
    latents = None
    sugg = None

    try:
        tc = process_sessions(
            sessions,
            metric_keys=(config.metric_key, "srpe_load"),
            normalizer_min_n=config.normalizer_min_n,
            clip_z=config.clip_z,
        )
    except Exception as e:  # keep runner resilient
        issues.append(
            Issue(
                severity=Severity.ERROR,
                code="training_core_failed",
                message="training_core processing failed.",
                field="process_sessions",
                value=str(e),
            )
        )

    # 2) select athlete
    if tc is not None:
        athlete_series = tc.by_athlete.get(config.athlete_id)
        if athlete_series is None:
            issues.append(
                Issue(
                    severity=Severity.ERROR,
                    code="athlete_not_found",
                    message="Requested athlete_id not present in processed sessions.",
                    field="athlete_id",
                    value=config.athlete_id,
                    meta={"available": list(tc.by_athlete.keys())},
                )
            )

    # 3) trends
    if athlete_series is not None:
        trend = compute_trends(
            athlete_series,
            metric_key=config.metric_key,
            use_normalized=config.use_normalized,
            smooth_method=config.smooth_method,  # "ewma" or "rolling_mean"
            ewma_alpha=config.ewma_alpha,
            slope_threshold=config.slope_threshold_norm if config.use_normalized else 1.0,
            lookback=config.lookback,
        )
        issues.extend(trend.issues)

    # 4) latents
    if athlete_series is not None and trend is not None:
        latents = compute_latent_states(
            athlete_series,
            metric_key=config.metric_key,
            use_normalized=config.use_normalized,
            trend=trend,
            fatigue_alpha=config.fatigue_alpha,
            plateau_lookback=config.plateau_lookback,
        )
        issues.extend(latents.issues)

    # 5) suggestions
    if athlete_series is not None:
        sugg = suggest_scenarios(
            athlete_series,
            metric_key=config.metric_key,
            use_normalized=config.use_normalized,
        )
        issues.extend(sugg.issues)

    # Summary (non-deterministic, just descriptive)
    top = sugg.scenarios[0] if sugg and sugg.scenarios else None
    summary: dict[str, float | str] = {
        "run_id": run_id,
        "athlete_id": config.athlete_id,
        "metric_key": config.metric_key,
        "used_normalized": str(bool(config.use_normalized)),
        "top_scenario": top.name.value if top else "none",
        "top_probability": float(top.probability) if top else 0.0,
        "confidence_top": float(top.confidence) if top else 0.0,
    }

    # 6) Logging (JSONL)
    if config.log_enabled and sugg is not None:
        entry = DecisionLogEntry(
            run_id=run_id,
            generated_at_utc=now.isoformat(),
            engine_version=ENGINE_VERSION,
            config_fingerprint=cfg_fp,
            athlete_id=config.athlete_id,
            metric_key=config.metric_key,
            used_normalized=config.use_normalized,
            summary=summary,
            scenarios=[
                {
                    "name": s.name.value,
                    "probability": float(s.probability),
                    "confidence": float(s.confidence),
                    "title": s.title,
                    "levers": s.levers,
                }
                for s in sugg.scenarios
            ],
            issues_summary=summarize_issues_for_log(issues),
        )
        try:
            write_jsonl(entry, config.log_path)
        except Exception as e:
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="log_write_failed",
                    message="Failed to write decision log entry.",
                    field="log_path",
                    value=str(e),
                    meta={"path": config.log_path},
                )
            )

    return EndToEndResult(
        run_id=run_id,
        generated_at_utc=now,
        engine_version=ENGINE_VERSION,
        config_fingerprint=cfg_fp,
        config=cfg_dict,
        training_core=tc,
        athlete_series=athlete_series,
        trend=trend,
        latents=latents,
        suggestions=sugg,
        issues=issues,
        summary=summary,
    )
