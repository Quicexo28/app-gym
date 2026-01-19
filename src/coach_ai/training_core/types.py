from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dc_field
from enum import StrEnum
from typing import Any


class Severity(StrEnum):
    """Severity of a validation issue.

    - ERROR: data should not be used without human correction.
    - WARN: data is usable but has uncertainty or suspicious values.
    - INFO: informational notes (e.g., missing modality).
    """

    ERROR = "error"
    WARN = "warn"
    INFO = "info"


@dataclass(frozen=True, slots=True)
class Issue:
    """A structured issue emitted by validation / fitting steps.

    This object is intentionally *not* an exception. The engine reduces uncertainty by
    surfacing issues; it does not silently correct data nor block the user by default.
    """

    severity: Severity
    code: str
    message: str
    field: str | None = None
    value: Any | None = None
    meta: dict[str, Any] = dc_field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity.value,
            "code": self.code,
            "message": self.message,
            "field": self.field,
            "value": self.value,
            "meta": self.meta,
        }
