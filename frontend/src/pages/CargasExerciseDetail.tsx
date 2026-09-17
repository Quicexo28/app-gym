import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { getSessions, type SessionRecord } from "../api";
import { ChartPlaceholder, ProgressChart } from "../components/Charts";
import { formatPercentDelta } from "../lib/bodyMetrics";
import { buildExerciseHistory, type ExerciseLogPoint } from "../lib/loadHistory";
import { formatWeight } from "../lib/units";
import { useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { APP_LOCALE } from "../lib/locale";

function formatExerciseNameForDisplay(name: string): string {
  return name.replace(/\s*>\s*/g, " - ").trim();
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(APP_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

function deltaClass(deltaLabel: string | null): string {
  if (!deltaLabel || deltaLabel === "Sin cambio") return "metricCardDelta flat";
  return deltaLabel.startsWith("-") ? "metricCardDelta down" : "metricCardDelta up";
}

function formatSetsSummary(point: ExerciseLogPoint, weightUnit: "kg" | "lb"): string {
  return point.sets
    .map((set) => `${set.reps}x${formatWeight(set.load_kg, weightUnit)}`)
    .join(", ");
}

export default function CargasExerciseDetail() {
  const navigate = useNavigate();
  const params = useParams();
  const exerciseName = decodeURIComponent(params.exerciseKey || "");
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [compareDates, setCompareDates] = useState<string[]>([]);

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

  const history = useMemo(() => buildExerciseHistory(sessions, exerciseName), [sessions, exerciseName]);
  const latest = history[history.length - 1] || null;
  const previous = history[history.length - 2] || null;
  const gainLabel = formatPercentDelta(latest?.topLoadKg ?? null, previous?.topLoadKg ?? null);

  const comparePair = useMemo(
    () => compareDates.map((date) => history.find((point) => point.date === date)).filter(Boolean) as ExerciseLogPoint[],
    [compareDates, history],
  );
  const compareGain =
    comparePair.length === 2 ? formatPercentDelta(comparePair[1].topLoadKg, comparePair[0].topLoadKg) : null;

  function toggleCompare(date: string) {
    setCompareDates((prev) => {
      if (prev.includes(date)) return prev.filter((entry) => entry !== date);
      if (prev.length >= 2) return [prev[1], date];
      return [...prev, date];
    });
  }

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>{formatExerciseNameForDisplay(exerciseName)}</h3>
          <p>Progreso de carga registrado en tus sesiones.</p>
        </div>
        <div className="quickActions" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => navigate("/profile/progress/cargas/ejercicios")}>
            Volver a ejercicios
          </button>
        </div>
      </section>

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando histórico de sesiones...</div>
        </section>
      ) : history.length === 0 ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Gráfica de progreso</h3>
            <p>Mejor carga por sesión a lo largo del tiempo.</p>
          </div>
          <div style={{ marginTop: 12 }}>
            <ChartPlaceholder variant="line" height={140} caption="Aún no hay registros de este ejercicio." />
          </div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="statsGrid">
              <article className="statCard">
                <div className="smallLabel">Mejor carga (última sesión)</div>
                <strong>{latest ? formatWeight(latest.topLoadKg, prefs.weightUnit) : "-"}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">% ganancia vs sesión anterior</div>
                <strong className={deltaClass(gainLabel)}>{gainLabel || "Sin comparación"}</strong>
              </article>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Gráfica de progreso</h3>
              <p>Mejor carga por sesión a lo largo del tiempo.</p>
            </div>
            <div style={{ marginTop: 12 }}>
              <ProgressChart
                values={history.map((point) => point.topLoadKg)}
                startLabel={formatDateShort(history[0].date)}
                endLabel={formatDateShort(history[history.length - 1].date)}
              />
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Comparar sesiones</h3>
              <p>Selecciona dos fechas para ver el cambio entre ellas.</p>
            </div>
            <div className="pillGroup" style={{ marginTop: 12 }}>
              {[...history].reverse().map((point) => (
                <button
                  key={point.date}
                  type="button"
                  className={`pill ${compareDates.includes(point.date) ? "active" : ""}`}
                  onClick={() => toggleCompare(point.date)}
                >
                  <span>{formatDateShort(point.date)}</span>
                  <small>{formatWeight(point.topLoadKg, prefs.weightUnit)}</small>
                </button>
              ))}
            </div>

            {comparePair.length === 2 ? (
              <div className="surface" style={{ marginTop: 12 }}>
                <div className="stack compactStack">
                  <div>
                    <strong>{formatDateShort(comparePair[0].date)}</strong>
                    <div className="small">{formatSetsSummary(comparePair[0], prefs.weightUnit)}</div>
                  </div>
                  <div>
                    <strong>{formatDateShort(comparePair[1].date)}</strong>
                    <div className="small">{formatSetsSummary(comparePair[1], prefs.weightUnit)}</div>
                  </div>
                </div>
                <strong className={deltaClass(compareGain)} style={{ display: "block", marginTop: 8 }}>
                  {compareGain || "Sin cambio"}
                </strong>
                <div className="quickActions" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => setCompareDates([])}>
                    Limpiar comparación
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Histórico de sesiones</h3>
              <p>Series y cargas registradas en cada sesión.</p>
            </div>
            <div className="stack compactStack" style={{ marginTop: 12 }}>
              {[...history].reverse().map((point) => (
                <article key={point.date} className="listItem">
                  <div className="listMain">
                    <strong>{formatDateShort(point.date)}</strong>
                    <span className="small">{formatSetsSummary(point, prefs.weightUnit)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
