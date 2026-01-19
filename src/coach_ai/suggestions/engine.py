from __future__ import annotations

from dataclasses import dataclass

from coach_ai.latents.types import LatentResult
from coach_ai.suggestions.scoring import clamp01, issue_penalty, softmax
from coach_ai.suggestions.types import Scenario, ScenarioName
from coach_ai.trends.types import TrendDirection, TrendResult


@dataclass(frozen=True, slots=True)
class SuggestionContext:
    """Context used by the scenario engine (last-point driven by default)."""

    fatigue_p: float | None
    readiness_p: float | None
    plateau_p: float | None
    trend_dir: TrendDirection
    trend_conf: float
    latent_conf: float
    coverage: float
    issues_penalty: float


def _safe(x: float | None) -> float:
    return 0.5 if x is None else float(x)


def build_context(
    *,
    trend: TrendResult,
    latents: LatentResult,
) -> SuggestionContext:
    # last point
    t_last = trend.points[-1] if trend.points else None
    l_last = latents.points[-1] if latents.points else None

    fatigue = None if l_last is None else l_last.states.get("fatigue")
    readiness = None if l_last is None else l_last.states.get("readiness")
    plateau = None if l_last is None else l_last.states.get("plateau")

    trend_dir = TrendDirection.INSUFFICIENT if t_last is None else t_last.direction
    trend_conf = 0.0 if t_last is None else float(t_last.confidence)
    latent_conf = 0.0 if l_last is None else float(l_last.confidence)

    cov = (
        float(latents.summary.get("coverage", 0.0))
        if isinstance(latents.summary.get("coverage"), float)
        else 0.0
    )

    pen = issue_penalty(list(trend.issues) + list(latents.issues))

    return SuggestionContext(
        fatigue_p=fatigue,
        readiness_p=readiness,
        plateau_p=plateau,
        trend_dir=trend_dir,
        trend_conf=trend_conf,
        latent_conf=latent_conf,
        coverage=cov,
        issues_penalty=pen,
    )


def generate_scenarios(ctx: SuggestionContext) -> list[Scenario]:
    """Generate scenario list with probabilities and confidences.

    This is intentionally:
    - directional (levers), not prescriptive (no exact kg/sets)
    - probabilistic and explainable
    """
    f = _safe(ctx.fatigue_p)
    r = _safe(ctx.readiness_p)
    p = _safe(ctx.plateau_p)

    # Heuristic scores (higher = more recommended), later softmax -> probabilities.
    # We keep it transparent: each score is built from simple signal terms.
    scores: dict[ScenarioName, float] = {
        ScenarioName.RECOVERY: 0.0,
        ScenarioName.MAINTENANCE: 0.0,
        ScenarioName.PROGRESSION: 0.0,
        ScenarioName.VARIATION: 0.0,
        ScenarioName.STABILIZE: 0.0,
        ScenarioName.DATA_REVIEW: 0.0,
    }

    # DATA_REVIEW: if issues penalty is high, bring this option up.
    scores[ScenarioName.DATA_REVIEW] += 2.2 * ctx.issues_penalty

    # RECOVERY: fatigue high and/or readiness low
    scores[ScenarioName.RECOVERY] += 2.0 * max(0.0, f - 0.65)
    scores[ScenarioName.RECOVERY] += 1.6 * max(0.0, 0.35 - r)
    if ctx.trend_dir == TrendDirection.UP:
        scores[ScenarioName.RECOVERY] += 0.4 * ctx.trend_conf

    # PROGRESSION: readiness high and fatigue not high
    scores[ScenarioName.PROGRESSION] += 1.8 * max(0.0, r - 0.60)
    scores[ScenarioName.PROGRESSION] += 1.2 * max(0.0, 0.55 - f)
    if ctx.trend_dir == TrendDirection.DOWN:
        scores[ScenarioName.PROGRESSION] += 0.2 * ctx.trend_conf

    # VARIATION: plateau risk high with acceptable readiness
    scores[ScenarioName.VARIATION] += 2.0 * max(0.0, p - 0.60)
    scores[ScenarioName.VARIATION] += 0.8 * max(0.0, r - 0.45)
    if ctx.trend_dir == TrendDirection.STABLE:
        scores[ScenarioName.VARIATION] += 0.3 * ctx.trend_conf

    # STABILIZE: trend volatile
    if ctx.trend_dir == TrendDirection.VOLATILE:
        scores[ScenarioName.STABILIZE] += 1.8 * ctx.trend_conf
        scores[ScenarioName.STABILIZE] += 0.6 * (1.0 - ctx.coverage)

    # MAINTENANCE: default safe middle when nothing screams
    mid = 1.0 - abs(f - 0.5) - abs(r - 0.5)  # highest near middle
    scores[ScenarioName.MAINTENANCE] += 0.8 * max(0.0, mid)
    if ctx.trend_dir in (TrendDirection.STABLE, TrendDirection.INSUFFICIENT):
        scores[ScenarioName.MAINTENANCE] += 0.2 * (1.0 - ctx.trend_conf)

    # Convert to probabilities
    ordered = [
        ScenarioName.RECOVERY,
        ScenarioName.MAINTENANCE,
        ScenarioName.PROGRESSION,
        ScenarioName.VARIATION,
        ScenarioName.STABILIZE,
        ScenarioName.DATA_REVIEW,
    ]
    probs = softmax([scores[n] for n in ordered])

    # Scenario confidence = evidence quality (not probability), penalized by issues
    base_evidence = clamp01(0.15 + 0.55 * ctx.latent_conf + 0.30 * ctx.trend_conf)
    conf = clamp01(base_evidence * (1.0 - ctx.issues_penalty))

    def mk(
        name: ScenarioName,
        prob: float,
    ) -> Scenario:
        if name == ScenarioName.RECOVERY:
            return Scenario(
                name=name,
                probability=prob,
                confidence=conf,
                title="Escenario: recuperación / reducción de estrés",
                explanation=[
                    f"Fatiga relativa alta (p≈{f:.2f}) y/o preparación baja (p≈{r:.2f}).",
                    f"Tendencia actual: {ctx.trend_dir.value} (conf≈{ctx.trend_conf:.2f}).",
                    "Objetivo: bajar incertidumbre fisiológica reduciendo carga relativa reciente.",
                ],
                tradeoffs=[
                    "Puede frenar la progresión a corto plazo.",
                    "Si se extiende demasiado, puede reducir estímulo.",
                ],
                levers={
                    "volume": "down",
                    "intensity": "down_or_neutral",
                    "proximity_to_failure": "further_from_failure",
                    "variation": "low",
                    "consistency": "high",
                },
                load_zone_z=(-1.2, -0.2),
            )

        if name == ScenarioName.PROGRESSION:
            return Scenario(
                name=name,
                probability=prob,
                confidence=conf,
                title="Escenario: progresión conservadora",
                explanation=[
                    f"Preparación relativamente alta (p≈{r:.2f}) con fatiga no alta (p≈{f:.2f}).",
                    "Objetivo: aumentar estímulo de forma gradual sin asumir respuesta perfecta.",
                ],
                tradeoffs=[
                    "Riesgo de aumentar fatiga si el contexto externo (sueño/estrés) empeora.",
                    "Puede ser insuficiente si hay estancamiento real (plateau alto).",
                ],
                levers={
                    "volume": "up_slightly",
                    "intensity": "neutral_or_up_slightly",
                    "proximity_to_failure": "neutral",
                    "variation": "low_or_medium",
                    "consistency": "high",
                },
                load_zone_z=(0.2, 0.9),
            )

        if name == ScenarioName.VARIATION:
            return Scenario(
                name=name,
                probability=prob,
                confidence=conf,
                title="Escenario: romper patrón / introducir variación",
                explanation=[
                    f"Probabilidad de plateau elevada (p≈{p:.2f}) con preparación suficiente (p≈{r:.2f}).",
                    f"Tendencia: {ctx.trend_dir.value} (conf≈{ctx.trend_conf:.2f}).",
                    "Objetivo: cambiar variables del estímulo (no necesariamente aumentar carga).",
                ],
                tradeoffs=[
                    "Cambios pueden introducir ruido y dificultar comparar series.",
                    "Demasiada variación puede reducir especificidad técnica.",
                ],
                levers={
                    "variation": "medium_or_high",
                    "rep_range": "change",
                    "exercise_selection": "change_within_goal",
                    "volume": "neutral_or_slight_up",
                    "consistency": "medium",
                },
                load_zone_z=(0.0, 0.8),
            )

        if name == ScenarioName.STABILIZE:
            return Scenario(
                name=name,
                probability=prob,
                confidence=conf,
                title="Escenario: estabilizar (reducir volatilidad)",
                explanation=[
                    "Señales de volatilidad en la tendencia (cambios frecuentes de dirección).",
                    "Objetivo: reducir variabilidad para interpretar mejor respuesta individual.",
                ],
                tradeoffs=[
                    "Puede sentirse 'lento' si el usuario busca cambios rápidos.",
                    "Menos variación puede aburrir; prioriza control del sistema.",
                ],
                levers={
                    "consistency": "very_high",
                    "variation": "low",
                    "volume": "neutral",
                    "intensity": "neutral",
                    "measurement_hygiene": "improve_logging",
                },
                load_zone_z=(-0.2, 0.6),
            )

        if name == ScenarioName.DATA_REVIEW:
            return Scenario(
                name=name,
                probability=prob,
                confidence=clamp01(conf * 0.9),
                title="Escenario: revisión de datos (calidad / consistencia)",
                explanation=[
                    "Se detectó incertidumbre alta por issues (validación/normalización/trends).",
                    "Objetivo: mejorar calidad de datos antes de interpretar señales finas.",
                ],
                tradeoffs=[
                    "No optimiza entrenamiento: optimiza la confiabilidad del sistema.",
                    "Requiere disciplina de registro.",
                ],
                levers={
                    "logging": "improve",
                    "missing_values": "reduce",
                    "time_ordering": "check_timezones",
                    "exercise_naming": "standardize",
                },
                load_zone_z=None,
            )

        # MAINTENANCE
        return Scenario(
            name=ScenarioName.MAINTENANCE,
            probability=prob,
            confidence=conf,
            title="Escenario: mantenimiento / continuidad",
            explanation=[
                f"Señales mixtas o moderadas (fatiga≈{f:.2f}, readiness≈{r:.2f}, plateau≈{p:.2f}).",
                "Objetivo: sostener estímulo con mínima incertidumbre adicional.",
            ],
            tradeoffs=[
                "Puede no ser suficiente si el objetivo es acelerar progreso.",
                "Puede no resolver plateau si éste aumenta en próximas semanas.",
            ],
            levers={
                "volume": "neutral",
                "intensity": "neutral",
                "variation": "low",
                "consistency": "high",
            },
            load_zone_z=(-0.2, 0.4),
        )

    scenarios = [mk(name, prob) for name, prob in zip(ordered, probs, strict=True)]
    # Sort by probability descending (presentation)
    scenarios.sort(key=lambda s: s.probability, reverse=True)
    return scenarios
