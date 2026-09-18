from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True, slots=True)
class ExerciseState:
    """Descriptive state of one exercise. No model, no forecast."""

    name: str
    sessions: int
    last_top_load_kg: float
    best_top_load_kg: float
    e1rm_kg: float
    best_e1rm_kg: float
    last_session_at: datetime
    days_since_last: int
    sets_last_4w: int


@dataclass(frozen=True, slots=True)
class TrainingEvent:
    """Something that happened, with the rule that detected it written down.

    `rule` is part of the payload on purpose: an event the athlete cannot audit
    is indistinguishable from an opinion.
    """

    kind: str  # personal_record | stall | dropped_exercise | volume_drop
    exercise: str | None
    at: datetime
    detail: str
    rule: str


@dataclass(frozen=True, slots=True)
class NextSetPrediction:
    """Next top set for one exercise.

    The point estimate is the last top set: three backtests over real logs
    showed no model beating that baseline (MAE 6.14 kg vs 6.44 kg for the best
    fitted model). What the engine adds is the interval, calibrated on the
    athlete's own history, and the honesty to abstain.
    """

    exercise: str
    point_kg: float
    low_kg: float
    high_kg: float
    coverage: float
    basis_sessions: int
    method: str


@dataclass(frozen=True, slots=True)
class TrainingSignal:
    """Lo que dicen los datos, no lo que hay que hacer.

    La app no prescribe: nombra lo que ve y entrega el contexto. Quien decide es
    el entrenador (o el atleta con su criterio). Por eso `reading` se redacta
    como lectura y no como instruccion, y `reference_load_kg` es un dato de
    apoyo para quien programa, no una orden de carga.

    `rule` es la condicion generica que se cumplio; `evidence`, los numeros
    concretos de este atleta. Sin las dos, la señal seria una opinion disfrazada
    de dato.
    """

    kind: str  # progression_margin | effort_at_limit | plan_shortfall | fatigue_rising
    exercise: str
    reading: str
    evidence: str
    rule: str
    reference_load_kg: float | None


@dataclass(frozen=True, slots=True)
class Projection:
    """Lo que cabe esperar si el atleta sostiene lo que viene haciendo.

    Sale de extrapolar **su propia** tendencia (Theil-Sen sobre el 1RM estimado),
    no de un modelo poblacional: ese se midio y no supera baselines triviales.
    Es condicional a la adherencia observada (`adherence`) y siempre viaja con
    intervalo: la variabilidad entre bloques es alta y esconderla seria mentir.
    """

    scope: str  # "global" o el nombre del ejercicio
    horizon_weeks: int
    current_kg: float | None
    expected_change_kg: float | None
    low_change_kg: float | None
    high_change_kg: float | None
    expected_change_pct: float
    adherence: float | None
    basis_sessions: int
    method: str
    low_change_pct: float | None = None
    high_change_pct: float | None = None


@dataclass(frozen=True, slots=True)
class AthleteInsights:
    athlete_id: str
    generated_at: datetime
    exercises: list[ExerciseState] = field(default_factory=list)
    events: list[TrainingEvent] = field(default_factory=list)
    predictions: list[NextSetPrediction] = field(default_factory=list)
    signals: list[TrainingSignal] = field(default_factory=list)
    projections: list[Projection] = field(default_factory=list)
    abstained: list[str] = field(default_factory=list)
    weekly_sets_by_group: dict[str, float] = field(default_factory=dict)
    sessions_last_4w: int = 0
