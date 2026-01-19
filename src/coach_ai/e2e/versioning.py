from __future__ import annotations

import hashlib
import json
from typing import Any

ENGINE_VERSION = "phase5-e2e-0.1.0"


def fingerprint_config(config: dict[str, Any]) -> str:
    """Stable fingerprint of a config dict (order-invariant)."""
    payload = json.dumps(config, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
