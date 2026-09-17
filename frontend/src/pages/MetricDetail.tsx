import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { BodyMetricKey } from "../api";
import { ChartPlaceholder, ProgressChart } from "../components/Charts";
import {
  buildDefinitionByKey,
  displayMetricValue,
  FIELD_GROUPS,
  formatPercentDelta,
  metricUnitLabel,
  useBodyMeasurements,
} from "../lib/bodyMetrics";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { APP_LOCALE } from "../lib/locale";

const VALID_KEYS = new Set<string>(FIELD_GROUPS.flatMap((group) => group.keys));

function deltaClass(deltaLabel: string | null): string {
  if (!deltaLabel || deltaLabel === "Sin cambio") return "metricCardDelta flat";
  return deltaLabel.startsWith("-") ? "metricCardDelta down" : "metricCardDelta up";
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(APP_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

export default function MetricDetail() {
  const navigate = useNavigate();
  const params = useParams();
  const metricKey = params.metricKey || "";
  const [athleteId] = useAthleteId();
  const { activeSubject } = useAthleteAccess();
  const { prefs } = usePreferences();
  const { definitions, history, loading, error } = useBodyMeasurements(athleteId);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const definitionByKey = useMemo(() => buildDefinitionByKey(definitions), [definitions]);
  const isValidKey = VALID_KEYS.has(metricKey);
  const key = metricKey as BodyMetricKey;
  const info = definitionByKey.get(key);

  const points = useMemo(() => {
    if (!isValidKey) return [];
    return history
      .map((item) => ({ id: item.id, date: item.measured_at, value: displayMetricValue(item, key, prefs.weightUnit) }))
      .filter((entry): entry is { id: string; date: string; value: number } => entry.value !== null)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [history, isValidKey, key, prefs.weightUnit]);

  const latestPoint = points[points.length - 1] || null;
  const previousPoint = points[points.length - 2] || null;
  const gainLabel = formatPercentDelta(latestPoint?.value ?? null, previousPoint?.value ?? null);
  const unit = info ? metricUnitLabel(key, info, prefs.weightUnit) : "";

  const comparePair = useMemo(
    () => compareIds.map((id) => points.find((point) => point.id === id)).filter(Boolean) as typeof points,
    [compareIds, points],
  );
  const compareGain =
    comparePair.length === 2 ? formatPercentDelta(comparePair[1].value, comparePair[0].value) : null;

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((entry) => entry !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  if (!isValidKey) {
    return (
      <section className="surface">
        <div className="emptyState">Medida desconocida.</div>
        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => navigate("/profile/progress")}>
            Volver
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>{info?.label || metricKey}</h3>
          <p>{info?.description}</p>
        </div>
        <div className="chipRow" style={{ marginTop: 10 }}>
          <span className="chip">{`Sujeto: ${activeSubject?.label || "Sin sujeto"}`}</span>
          <span className="chip">{`Registros: ${points.length}`}</span>
        </div>
        <div className="quickActions" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => navigate("/profile/progress")}>
            Volver a medidas
          </button>
        </div>
      </section>

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando histórico...</div>
        </section>
      ) : points.length === 0 ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Gráfica de progreso</h3>
            <p>Evolucion cronologica de esta medida.</p>
          </div>
          <div style={{ marginTop: 12 }}>
            <ChartPlaceholder variant="line" height={140} caption="Aún no hay registros de esta medida." />
          </div>
          <div className="quickActions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => navigate(`/profile/progress/medida/nueva?key=${key}`)}>
              Registrar esta medida
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="statsGrid">
              <article className="statCard">
                <div className="smallLabel">Último valor</div>
                <strong>{`${latestPoint ? latestPoint.value.toFixed(1) : "-"} ${unit}`}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">% ganancia vs anterior</div>
                <strong className={deltaClass(gainLabel)}>{gainLabel || "Sin comparación"}</strong>
              </article>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Gráfica de progreso</h3>
              <p>Evolucion cronologica de esta medida.</p>
            </div>
            <div style={{ marginTop: 12 }}>
              <ProgressChart
                values={points.map((point) => point.value)}
                startLabel={formatDateShort(points[0].date)}
                endLabel={formatDateShort(points[points.length - 1].date)}
              />
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Comparar fechas</h3>
              <p>Selecciona dos registros para ver el cambio entre ellos.</p>
            </div>
            <div className="pillGroup" style={{ marginTop: 12 }}>
              {[...points].reverse().map((point) => (
                <button
                  key={point.id}
                  type="button"
                  className={`pill ${compareIds.includes(point.id) ? "active" : ""}`}
                  onClick={() => toggleCompare(point.id)}
                >
                  <span>{formatDateShort(point.date)}</span>
                  <small>{`${point.value.toFixed(1)} ${unit}`}</small>
                </button>
              ))}
            </div>

            {comparePair.length === 2 ? (
              <div className="surface" style={{ marginTop: 12 }}>
                <div className="chipRow">
                  <span className="chip">{formatDateShort(comparePair[0].date)}</span>
                  <span className="chip">{`${comparePair[0].value.toFixed(1)} ${unit}`}</span>
                  <span className="chip">→</span>
                  <span className="chip">{formatDateShort(comparePair[1].date)}</span>
                  <span className="chip">{`${comparePair[1].value.toFixed(1)} ${unit}`}</span>
                </div>
                <strong className={deltaClass(compareGain)} style={{ display: "block", marginTop: 8 }}>
                  {compareGain || "Sin cambio"}
                </strong>
                <div className="quickActions" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => setCompareIds([])}>
                    Limpiar comparación
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Histórico</h3>
              <p>Todas las tomas registradas para esta medida.</p>
            </div>
            <div className="stack compactStack" style={{ marginTop: 12 }}>
              {[...points].reverse().map((point) => (
                <article key={point.id} className="listItem">
                  <div className="listMain">
                    <strong>{formatDateShort(point.date)}</strong>
                    <span className="small">{`${point.value.toFixed(1)} ${unit}`}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="surface">
            <div className="quickActions">
              <button className="btn primary" onClick={() => navigate(`/profile/progress/medida/nueva?key=${key}`)}>
                Registrar esta medida
              </button>
              <button className="btn" onClick={() => navigate("/profile/progress/medida/nueva")}>
                Registrar todas las medidas
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}
