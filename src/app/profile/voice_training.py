from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import GamificationConfig

VOICE_TRAINING_SCOPE = "voice_training_global"
MAX_KEYWORD_LENGTH = 48
MAX_KEYWORDS_PER_INTENT = 80
MAX_WAKE_ALIASES = 20
MAX_PHRASE_CORRECTIONS = 80


def _now_ms() -> int:
    return int(datetime.now(tz=UTC).timestamp() * 1000)


def default_voice_training_config() -> dict[str, Any]:
    return {
        "updated_at_ms": 0,
        "custom_keywords": {
            "set_reps": [],
            "set_load": [],
            "set_set_effort": [],
            "set_set_completed": [],
        },
        "wake_aliases": [],
        "phrase_corrections": [],
    }


def _normalize_transcript(value: str) -> str:
    lowered = (
        unicodedata.normalize("NFD", value.lower())
        .replace("\u0300", "")
        .replace("\u0301", "")
        .replace("\u0302", "")
        .replace("\u0303", "")
        .replace("\u0304", "")
        .replace("\u0306", "")
        .replace("\u0307", "")
        .replace("\u0308", "")
    )
    lowered = "".join(ch for ch in lowered if unicodedata.category(ch) != "Mn")
    lowered = re.sub(r"[^a-z0-9.,\s]", " ", lowered)
    return " ".join(lowered.split()).strip()


def _sanitize_keyword(raw: Any) -> str:
    if not isinstance(raw, str):
        return ""
    return _normalize_transcript(raw)[:MAX_KEYWORD_LENGTH].strip()


def _sanitize_keyword_list(raw: Any, *, limit: int = MAX_KEYWORDS_PER_INTENT) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        keyword = _sanitize_keyword(item)
        if not keyword or keyword in seen:
            continue
        seen.add(keyword)
        out.append(keyword)
        if len(out) >= limit:
            break
    return out


def _sanitize_phrase_corrections(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        from_value = _sanitize_keyword(item.get("from"))
        to_value = _sanitize_keyword(item.get("to"))
        if not from_value or not to_value or from_value == to_value:
            continue
        dedupe_key = f"{from_value}=>{to_value}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        out.append({"from": from_value, "to": to_value})
        if len(out) >= MAX_PHRASE_CORRECTIONS:
            break
    return out


def normalize_voice_training_config(payload: dict[str, Any] | None) -> dict[str, Any]:
    defaults = default_voice_training_config()
    if not isinstance(payload, dict):
        return defaults

    raw_keywords = payload.get("custom_keywords")
    keywords = raw_keywords if isinstance(raw_keywords, dict) else {}
    updated_at_ms = payload.get("updated_at_ms")
    if isinstance(updated_at_ms, (int, float)):
        normalized_updated_at_ms = int(updated_at_ms)
    else:
        normalized_updated_at_ms = 0

    return {
        "updated_at_ms": max(0, normalized_updated_at_ms),
        "custom_keywords": {
            "set_reps": _sanitize_keyword_list(keywords.get("set_reps")),
            "set_load": _sanitize_keyword_list(keywords.get("set_load")),
            "set_set_effort": _sanitize_keyword_list(keywords.get("set_set_effort")),
            "set_set_completed": _sanitize_keyword_list(keywords.get("set_set_completed")),
        },
        "wake_aliases": _sanitize_keyword_list(payload.get("wake_aliases"), limit=MAX_WAKE_ALIASES),
        "phrase_corrections": _sanitize_phrase_corrections(payload.get("phrase_corrections")),
    }


def get_voice_training_config(db: Session) -> dict[str, Any]:
    row = db.execute(
        select(GamificationConfig).where(GamificationConfig.scope == VOICE_TRAINING_SCOPE)
    ).scalar_one_or_none()
    if row is None:
        return default_voice_training_config()
    return normalize_voice_training_config(row.config)


def upsert_voice_training_config(
    db: Session,
    *,
    payload: dict[str, Any],
    updated_by_user_id,
) -> dict[str, Any]:
    normalized = normalize_voice_training_config(payload)
    normalized["updated_at_ms"] = _now_ms()
    row = db.execute(
        select(GamificationConfig).where(GamificationConfig.scope == VOICE_TRAINING_SCOPE)
    ).scalar_one_or_none()
    if row is None:
        row = GamificationConfig(
            scope=VOICE_TRAINING_SCOPE,
            config=normalized,
            updated_by_user_id=updated_by_user_id,
        )
        db.add(row)
    else:
        row.config = normalized
        row.updated_by_user_id = updated_by_user_id
    db.commit()
    db.refresh(row)
    return normalize_voice_training_config(row.config)
