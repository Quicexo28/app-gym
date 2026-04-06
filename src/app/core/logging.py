from __future__ import annotations

import json
import logging
from typing import Any


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


def log_business_event(event: str, **payload: Any) -> None:
    logger = logging.getLogger("app.business")
    safe_payload = {
        key: value
        for key, value in payload.items()
        if value is None or isinstance(value, (str, int, float, bool, list, dict, tuple))
    }
    logger.info("business_event %s", json.dumps({"event": event, **safe_payload}, ensure_ascii=False, default=str))
