import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import {
  buildDefinitionByKey,
  FIELD_GROUPS,
  formatMetricValue,
  formatPercentDelta,
  rawMetricValue,
  useBodyMeasurements,
} from "../lib/bodyMetrics";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { APP_LOCALE } from "../lib/locale";

function deltaClass(deltaLabel: string | null): string {
  if (!deltaLabel || deltaLabel === "Sin cambio") return "metricCardDelta flat";
  return deltaLabel.startsWith("-") ? "metricCardDelta down" : "metricCardDelta up";
}

export default function BodyMetrics() {
  const navigate = useNavigate();
  const [athleteId] = useAthleteId();
  const { activeSubject } = useAthleteAccess();
  const { prefs } = usePreferences();
  const { definitions, history, loading, error } = useBodyMeasurements(athleteId);

  const definitionByKey = useMemo(() => buildDefinitionByKey(definitions), [definitions]);
  const latest = history[0] || null;
  const previous = history[1] || null;

  const cards = useMemo(() => {
    return FIELD_GROUPS.map((group) => ({
      ...group,
      items: group.keys.map((key) => {
        const info = definitionByKey.get(key);
        const valueLabel = latest ? formatMetricValue(latest, key, prefs.weightUnit) : null;
        const deltaLabel = formatPercentDelta(
          latest ? rawMetricValue(latest, key) : null,
          previous ? rawMetricValue(previous, key) : null,
        );
        return { key, label: info?.label || key, valueLabel, deltaLabel };
      }),
    }));
  }, [definitionByKey, latest, prefs.weightUnit, previous]);

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>Progreso en medidas</h3>
          <p>{`Sujeto activo: ${activeSubject?.label || "Sin sujeto"}${latest ? ` | Último control: ${new Date(latest.measured_at).toLocaleDateString(APP_LOCALE)}` : ""}`}</p>
        </div>
        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => navigate("/profile/progress/medida/nueva")} disabled={!athleteId}>
            Registrar medidas
          </button>
        </div>
      </section>

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando histórico...</div>
        </section>
      ) : !latest ? (
        <section className="surface">
          <div className="emptyState">Aún no hay mediciones registradas para este sujeto.</div>
        </section>
      ) : (
        cards.map((group) => (
          <section key={group.title} className="surface">
            <div className="sectionHead">
              <h3>{group.title}</h3>
            </div>
            <div className="gridCards" style={{ marginTop: 12 }}>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="metricCard"
                  onClick={() => navigate(`/profile/progress/medida/${item.key}`)}
                >
                  <span className="smallLabel">{item.label}</span>
                  <strong className="metricCardValue">{item.valueLabel || "Sin datos"}</strong>
                  <span className={deltaClass(item.deltaLabel)}>{item.deltaLabel || "Sin comparación"}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
