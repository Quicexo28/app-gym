from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from coach_ai.training_core.types import Issue, Severity


@dataclass(frozen=True, slots=True)
class DecisionLogEntry:
    run_id: str
    generated_at_utc: str
    engine_version: str
    config_fingerprint: str
    athlete_id: str
    metric_key: str
    used_normalized: bool
    summary: dict[str, Any]
    scenarios: list[dict[str, Any]]
    issues_summary: dict[str, int]


def summarize_issues_for_log(issues: list[Issue]) -> dict[str, int]:
    out = {Severity.ERROR.value: 0, Severity.WARN.value: 0, Severity.INFO.value: 0}
    for i in issues:
        out[i.severity.value] = out.get(i.severity.value, 0) + 1
    return out


def write_jsonl(entry: DecisionLogEntry, path: str) -> None:
    """Append one JSON line to a log file (creates directories)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(entry)  # <-- funciona con dataclasses con slots
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
