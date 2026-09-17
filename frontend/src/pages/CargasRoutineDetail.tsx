import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { getSessions, type SessionRecord } from "../api";
import { Sparkline } from "../components/Charts";
import { formatPercentDelta } from "../lib/bodyMetrics";
import { buildExerciseHistory } from "../lib/loadHistory";
import { loadRoutines, ROUTINES_HYDRATED_EVENT } from "../lib/storage";
import { formatWeight } from "../lib/units";
import { useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

function formatExerciseNameForDisplay(name: string): string {
  return name.replace(/\s*>\s*/g, " - ").trim();
}

function deltaClass(deltaLabel: string | null): string {
  if (!deltaLabel || deltaLabel === "Sin cambio") return "metricCardDelta flat";
  return deltaLabel.startsWith("-") ? "metricCardDelta down" : "metricCardDelta up";
}

export default function CargasRoutineDetail() {
  const navigate = useNavigate();
  const params = useParams();
  const routineId = params.routineId || "";
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [routinesVersion, setRoutinesVersion] = useState(0);

  useEffect(() => {
    const onHydrated = () => setRoutinesVersion((tick) => tick + 1);
    window.addEventListener(ROUTINES_HYDRATED_EVENT, onHydrated);
    return () => window.removeEventListener(ROUTINES_HYDRATED_EVENT, onHydrated);
  }, []);

  const routine = useMemo(() => {
    if (!athleteId) return null;
    return loadRoutines(athleteId).find((item) => item.id === routineId) || null;
    // routinesVersion fuerza recalculo cuando el storage local se hidrata desde el backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, routineId, routinesVersion]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) {
        setSessions([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const items = await getSessions(athleteId);
        if (!cancelled) setSessions(items);
      } catch (cause: unknown) {
        if (!cancelled) setError(String((cause as { message?: string })?.message || cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const exerciseCards = useMemo(() => {
    if (!routine) return [];
    return routine.exercises.map((exercise) => {
      const history = buildExerciseHistory(sessions, exercise.name);
      const latest = history[history.length - 1] || null;
      const previous = history[history.length - 2] || null;
      return {
        name: exercise.name,
        history,
        latestLoadKg: latest ? latest.topLoadKg : null,
        gainLabel: formatPercentDelta(latest?.topLoadKg ?? null, previous?.topLoadKg ?? null),
      };
    });
  }, [routine, sessions]);

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>{routine ? routine.name : "Rutina"}</h3>
          <p>Progreso de carga por ejercicio dentro de esta rutina.</p>
        </div>
        <div className="quickActions" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => navigate("/profile/progress/cargas")}>
            Volver a rutinas
          </button>
        </div>
      </section>

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando histórico de sesiones...</div>
        </section>
      ) : !routine ? (
        <section className="surface">
          <div className="emptyState">No se encontro esta rutina.</div>
        </section>
      ) : (
        <div className="gridCards">
          {exerciseCards.map((item) => (
            <button
              key={item.name}
              type="button"
              className="surfaceButton"
              onClick={() => navigate(`/profile/progress/cargas/ejercicio/${encodeURIComponent(item.name)}`)}
            >
              <strong>{formatExerciseNameForDisplay(item.name)}</strong>
              <Sparkline values={item.history.map((point) => point.topLoadKg)} />
              <div className="chipRow">
                <span className="chip">
                  {`Último: ${item.latestLoadKg !== null ? formatWeight(item.latestLoadKg, prefs.weightUnit) : "-"}`}
                </span>
                <span className={deltaClass(item.gainLabel)}>{item.gainLabel || "Sin comparación"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
