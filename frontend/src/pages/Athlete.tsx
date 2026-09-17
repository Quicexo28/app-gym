import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { MUSCLE_GROUPS, getAthleteMuscleInsights, markAthleteSeen, muscleGroupLabel, updateCoachAthlete } from "../api";
import type { MuscleGroupState, MuscleInsightsResponse } from "../api";
import { Sparkline } from "../components/Charts";
import { useAthleteAccess } from "../state/athlete";

const TREND_LABEL: Record<string, string> = {
  up: "Progresando",
  down: "En baja",
  stable: "Estable",
  volatile: "Irregular",
  insufficient: "Sin datos suficientes",
};

function MuscleStateRow({ state, isWeakest }: { state: MuscleGroupState; isWeakest: boolean }) {
  const values = state.recent_series.map((point) => point.volume_kg);
  return (
    <div className={`muscleStateRow ${isWeakest ? "weakest" : ""}`.trim()}>
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <strong>{state.group}</strong>
        <span className="chip">{TREND_LABEL[state.trend_direction] || state.trend_direction}</span>
      </div>
      <Sparkline values={values} />
      <div className="small">
        {state.exercises_involved.length > 0
          ? state.exercises_involved.slice(0, 4).join(", ")
          : "Sin ejercicios registrados aún"}
      </div>
      {isWeakest ? <span className="chip notifyChip">Punto a reforzar</span> : null}
    </div>
  );
}

export default function AthleteDetail() {
  const params = useParams();
  const athleteId = decodeURIComponent(params.athleteId || "");
  const nav = useNavigate();
  const { subjects, setAthleteId } = useAthleteAccess();

  const [insights, setInsights] = useState<MuscleInsightsResponse | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const [draftGroups, setDraftGroups] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!athleteId) return;
    void markAthleteSeen(athleteId).catch(() => {});
  }, [athleteId]);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    getAthleteMuscleInsights(athleteId)
      .then((res) => {
        if (cancelled) return;
        setInsights(res);
        setDraftGroups(res.priority_muscle_groups);
      })
      .catch(() => {
        if (!cancelled) setInsights(null);
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  function openSection(path: string) {
    setAthleteId(athleteId);
    nav(path);
  }

  function toggleDraftGroup(group: string) {
    setDraftGroups((prev) => (prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group]));
  }

  async function savePlan() {
    setSaving(true);
    setError("");
    try {
      await updateCoachAthlete(athleteId, { priority_muscle_groups: draftGroups });
      const res = await getAthleteMuscleInsights(athleteId);
      setInsights(res);
      setEditingPlan(false);
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container stack">
      {/* El id interno (coach_7658dcb...) no le dice nada a nadie: se muestra el
          nombre del atleta tal como aparece en la cartera. */}
      <header className="titleBlock">
        <h1>{subjects.find((subject) => subject.id === athleteId)?.label || "Atleta"}</h1>
      </header>

      {error ? <section className="message error">{error}</section> : null}

      <div className="gridCards">
        <button type="button" className="surfaceButton" onClick={() => openSection("/training")}>
          <strong>Rutinas</strong>
          <span className="small">Plantillas, progreso y ajustes de rutina.</span>
        </button>
        <button type="button" className="surfaceButton" onClick={() => openSection("/profile/progress")}>
          <strong>Progresos</strong>
          <span className="small">Medidas, cargas y proyecciones.</span>
        </button>
        <button type="button" className="surfaceButton" onClick={() => openSection("/diet")}>
          <strong>Dieta</strong>
          <span className="small">Plan nutricional.</span>
        </button>
      </div>

      <section className="surface">
        <div className="sectionHead homeHead">
          <h3>Plan: músculos prioritarios</h3>
          <button type="button" className="btn btnSlim" onClick={() => setEditingPlan((prev) => !prev)}>
            {editingPlan ? "Cancelar" : "Editar"}
          </button>
        </div>

        {editingPlan ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="chipRow">
              {MUSCLE_GROUPS.map((group) => (
                <button
                  key={group}
                  type="button"
                  className={`chip chipToggle ${draftGroups.includes(group) ? "active" : ""}`.trim()}
                  onClick={() => toggleDraftGroup(group)}
                >
                  {muscleGroupLabel(group)}
                </button>
              ))}
            </div>
            <button type="button" className="btn primary" onClick={() => void savePlan()} disabled={saving}>
              {saving ? "Guardando..." : "Guardar plan"}
            </button>
          </div>
        ) : (
          <div className="chipRow" style={{ marginTop: 12 }}>
            {(insights?.priority_muscle_groups || []).length === 0 ? (
              <span className="small">Sin músculos prioritarios configurados.</span>
            ) : (
              insights?.priority_muscle_groups.map((group) => (
                <span key={group} className="chip">
                  {group}
                </span>
              ))
            )}
          </div>
        )}
      </section>

      <section className="surface">
        <div className="sectionHead homeHead">
          <h3>Progreso por músculo prioritario</h3>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {!insights || insights.states.length === 0 ? (
            <div className="emptyState">Configura músculos prioritarios para ver el progreso aquí.</div>
          ) : (
            insights.states.map((state) => (
              <MuscleStateRow key={state.group} state={state} isWeakest={state.group === insights.weakest_group} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
