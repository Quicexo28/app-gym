# training_core (Phase 1)

Scope:
- Domain schema: `Session`
- Validation that returns structured `Issue` objects (no prescriptions)
- Base derived metrics (e.g., sRPE load)
- Individual normalization (robust median/MAD)

Philosophy:
- Reduce uncertainty by surfacing issues with severity (ERROR/WARN/INFO).
- Avoid deterministic coaching language: the engine reports, the human decides.

Quick usage:

```python
from coach_ai.training_core import Session, validate_session, compute_session_metrics, fit_normalizer

s = Session(
    athlete_id="a1",
    start_time="2024-01-01T10:00:00Z",
    duration_min=60,
    rpe=7,
    modality="run",
    external_load={"distance_km": 10.0},
)

issues = validate_session(s)
metrics = compute_session_metrics(s)

params, fit_issues = fit_normalizer([100, 120, 110, 130, 125])
```
