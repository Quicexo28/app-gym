import { useEffect, useMemo, useState } from "react";

import {
  createBodyMeasurement,
  getBodyMetricDefinitions,
  getBodyMeasurementsHistory,
  type BodyMeasurementCreatePayload,
  type BodyMeasurementItem,
  type BodyMetricDefinition,
  type BodyMetricKey,
} from "../api";
import { formatWeight, fromKg } from "../lib/units";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

const FIELD_GROUPS: Array<{
  title: string;
  description: string;
  keys: BodyMetricKey[];
}> = [
  {
    title: "Base de composicion",
    description: "Medidas clave para seguimiento general.",
    keys: ["weight_kg", "height_cm", "waist_cm", "hip_cm", "body_fat_pct"],
  },
  {
    title: "Tren superior",
    description: "Perimetros de cuello, torso y brazos.",
    keys: ["neck_cm", "shoulders_cm", "chest_cm", "arm_relaxed_cm", "arm_flexed_cm", "forearm_cm"],
  },
  {
    title: "Tren inferior",
    description: "Perimetros para controlar progreso de piernas.",
    keys: ["thigh_cm", "calf_cm"],
  },
];

const FALLBACK_DEFINITIONS: BodyMetricDefinition[] = [
  { key: "weight_kg", label: "Peso corporal", unit: "kg", description: "Indicador base de tendencia global." },
  {
    key: "height_cm",
    label: "Estatura",
    unit: "cm",
    description: "Necesaria para calculos como IMC y ratio cintura/estatura.",
  },
  {
    key: "waist_cm",
    label: "Perimetro cintura",
    unit: "cm",
    description: "Medida prioritaria para composicion corporal y riesgo cardiometabolico.",
  },
  {
    key: "hip_cm",
    label: "Perimetro cadera",
    unit: "cm",
    description: "Util para ratio cintura/cadera y cambios de composicion.",
  },
  {
    key: "chest_cm",
    label: "Perimetro torax",
    unit: "cm",
    description: "Seguimiento de tren superior en fases de hipertrofia/definicion.",
  },
  {
    key: "shoulders_cm",
    label: "Perimetro hombros",
    unit: "cm",
    description: "Control de desarrollo del hombro y proporcion corporal.",
  },
  {
    key: "neck_cm",
    label: "Perimetro cuello",
    unit: "cm",
    description: "Apoya calculos de composicion con metodos antropometricos.",
  },
  {
    key: "arm_relaxed_cm",
    label: "Perimetro brazo relajado",
    unit: "cm",
    description: "Seguimiento estable del brazo sin sesgo por bombeo.",
  },
  {
    key: "arm_flexed_cm",
    label: "Perimetro brazo flexionado",
    unit: "cm",
    description: "Permite evaluar desarrollo muscular del brazo.",
  },
  {
    key: "forearm_cm",
    label: "Perimetro antebrazo",
    unit: "cm",
    description: "Detalle de progreso en tren superior distal.",
  },
  {
    key: "thigh_cm",
    label: "Perimetro muslo",
    unit: "cm",
    description: "Control de masa muscular del tren inferior.",
  },
  {
    key: "calf_cm",
    label: "Perimetro pantorrilla",
    unit: "cm",
    description: "Detalle de progreso del tren inferior distal.",
  },
  {
    key: "body_fat_pct",
    label: "% grasa corporal",
    unit: "%",
    description: "Estimacion opcional de composicion corporal.",
  },
];

const EMPTY_VALUES: Record<BodyMetricKey, string> = {
  weight_kg: "",
  height_cm: "",
  neck_cm: "",
  shoulders_cm: "",
  chest_cm: "",
  waist_cm: "",
  hip_cm: "",
  arm_relaxed_cm: "",
  arm_flexed_cm: "",
  forearm_cm: "",
  thigh_cm: "",
  calf_cm: "",
  body_fat_pct: "",
};

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseOptionalNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function formatMetricValue(item: BodyMeasurementItem, key: BodyMetricKey, weightUnit: "kg" | "lb"): string | null {
  const raw = item[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (key === "weight_kg") return formatWeight(raw, weightUnit);
  if (key === "body_fat_pct") return `${raw.toFixed(1)} %`;
  return `${raw.toFixed(1)} cm`;
}

function formatDelta(
  current: number | null,
  previous: number | null,
  unit: string,
  decimals = 1,
): string | null {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 1e-9) return "Sin cambio";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(decimals)} ${unit}`;
}

export default function BodyMetrics() {
  const [athleteId] = useAthleteId();
  const { activeSubject } = useAthleteAccess();
  const { prefs } = usePreferences();

  const [definitions, setDefinitions] = useState<BodyMetricDefinition[]>(FALLBACK_DEFINITIONS);
  const [history, setHistory] = useState<BodyMeasurementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [measuredAt, setMeasuredAt] = useState<string>(() => toLocalInputValue(new Date()));
  const [notes, setNotes] = useState("");
  const [values, setValues] = useState<Record<BodyMetricKey, string>>(EMPTY_VALUES);

  useEffect(() => {
    let cancelled = false;
    getBodyMetricDefinitions()
      .then((items) => {
        if (cancelled || items.length === 0) return;
        setDefinitions(items);
      })
      .catch(() => {
        if (!cancelled) setDefinitions(FALLBACK_DEFINITIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) {
        setHistory([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await getBodyMeasurementsHistory(athleteId, 120);
        if (cancelled) return;
        setHistory(response.items || []);
      } catch (cause: unknown) {
        if (cancelled) return;
        setHistory([]);
        setError(String((cause as { message?: string })?.message || cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const definitionByKey = useMemo(() => {
    const map = new Map<BodyMetricKey, BodyMetricDefinition>();
    for (const item of definitions) {
      map.set(item.key, item);
    }
    for (const fallback of FALLBACK_DEFINITIONS) {
      if (!map.has(fallback.key)) map.set(fallback.key, fallback);
    }
    return map;
  }, [definitions]);

  const latest = history[0] || null;
  const previous = history[1] || null;

  const weightDelta = useMemo(() => {
    if (!latest || !previous || typeof latest.weight_kg !== "number" || typeof previous.weight_kg !== "number") {
      return null;
    }
    const current = fromKg(latest.weight_kg, prefs.weightUnit);
    const prev = fromKg(previous.weight_kg, prefs.weightUnit);
    return formatDelta(current, prev, prefs.weightUnit, 1);
  }, [latest, previous, prefs.weightUnit]);

  const waistDelta = useMemo(() => {
    if (!latest || !previous || typeof latest.waist_cm !== "number" || typeof previous.waist_cm !== "number") return null;
    return formatDelta(latest.waist_cm, previous.waist_cm, "cm", 1);
  }, [latest, previous]);

  const fatDelta = useMemo(() => {
    if (!latest || !previous || typeof latest.body_fat_pct !== "number" || typeof previous.body_fat_pct !== "number") {
      return null;
    }
    return formatDelta(latest.body_fat_pct, previous.body_fat_pct, "%", 1);
  }, [latest, previous]);

  function setFieldValue(key: BodyMetricKey, next: string): void {
    setValues((prev) => ({ ...prev, [key]: next }));
  }

  async function saveMeasurement() {
    if (!athleteId) return;
    setSaving(true);
    setError("");
    setMsg("");

    try {
      const payload: BodyMeasurementCreatePayload = {
        athlete_id: athleteId,
      };

      if (measuredAt.trim()) {
        const parsed = new Date(measuredAt);
        if (Number.isNaN(parsed.getTime())) {
          setError("La fecha/hora es invalida.");
          return;
        }
        payload.measured_at = parsed.toISOString();
      }

      let anyMetric = false;
      for (const key of Object.keys(values) as BodyMetricKey[]) {
        const value = parseOptionalNumber(values[key]);
        if (value === null) continue;
        payload[key] = value;
        anyMetric = true;
      }

      if (!anyMetric) {
        setError("Debes ingresar al menos una medida numerica.");
        return;
      }

      const cleanNotes = notes.trim();
      if (cleanNotes) payload.notes = cleanNotes;

      await createBodyMeasurement(payload);
      const refreshed = await getBodyMeasurementsHistory(athleteId, 120);
      setHistory(refreshed.items || []);
      setMsg("Medicion guardada.");
      setValues({ ...EMPTY_VALUES });
      setNotes("");
      setMeasuredAt(toLocalInputValue(new Date()));
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setSaving(false);
    }
  }

  function renderInput(key: BodyMetricKey) {
    const info = definitionByKey.get(key);
    if (!info) return null;
    return (
      <label key={key} className="bodyMetricField">
        <span className="smallLabel">{info.label}</span>
        <div className="bodyMetricInputRow">
          <input
            className="input"
            value={values[key]}
            onChange={(e) => setFieldValue(key, e.target.value)}
            inputMode="decimal"
            placeholder="0.0"
          />
          <span className="chip">{info.unit}</span>
        </div>
      </label>
    );
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Medidas corporales</h1>
        <p>Registro historico de antropometria para el sujeto activo (coach o atleta).</p>
      </header>

      {error ? <section className="message error">{error}</section> : null}
      {msg ? <section className="message">{msg}</section> : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>Resumen actual</h3>
          <p>{`Sujeto activo: ${activeSubject?.label || "Sin sujeto"}`}</p>
        </div>
        {!latest ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aun no hay mediciones registradas.
          </div>
        ) : (
          <div className="statsGrid" style={{ marginTop: 12 }}>
            <article className="statCard">
              <div className="smallLabel">Ultimo control</div>
              <strong>{new Date(latest.measured_at).toLocaleString()}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Peso</div>
              <strong>
                {typeof latest.weight_kg === "number" ? formatWeight(latest.weight_kg, prefs.weightUnit) : "-"}
              </strong>
              <span className="small">{weightDelta ? `Delta: ${weightDelta}` : "Delta: -"}</span>
            </article>
            <article className="statCard">
              <div className="smallLabel">Cintura</div>
              <strong>{typeof latest.waist_cm === "number" ? `${latest.waist_cm.toFixed(1)} cm` : "-"}</strong>
              <span className="small">{waistDelta ? `Delta: ${waistDelta}` : "Delta: -"}</span>
            </article>
            <article className="statCard">
              <div className="smallLabel">% grasa</div>
              <strong>{typeof latest.body_fat_pct === "number" ? `${latest.body_fat_pct.toFixed(1)} %` : "-"}</strong>
              <span className="small">{fatDelta ? `Delta: ${fatDelta}` : "Delta: -"}</span>
            </article>
            <article className="statCard">
              <div className="smallLabel">IMC</div>
              <strong>{typeof latest.bmi === "number" ? latest.bmi.toFixed(2) : "-"}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Ratio cintura/estatura</div>
              <strong>
                {typeof latest.waist_to_height_ratio === "number" ? latest.waist_to_height_ratio.toFixed(3) : "-"}
              </strong>
            </article>
          </div>
        )}
      </section>

      <section className="surface stack compactStack">
        <div className="sectionHead">
          <h3>Nueva medicion</h3>
          <p>Completa solo las medidas que tomaste hoy. El sistema guarda historico completo por fecha.</p>
        </div>

        <div className="splitGrid">
          <label>
            <span className="smallLabel">Fecha y hora</span>
            <input
              className="input"
              type="datetime-local"
              value={measuredAt}
              onChange={(e) => setMeasuredAt(e.target.value)}
            />
          </label>
        </div>

        {FIELD_GROUPS.map((group) => (
          <article key={group.title} className="bodyMetricGroup">
            <div className="sectionHead">
              <h4>{group.title}</h4>
              <p>{group.description}</p>
            </div>
            <div className="bodyMetricGrid">{group.keys.map((key) => renderInput(key))}</div>
          </article>
        ))}

        <label>
          <span className="smallLabel">Notas</span>
          <textarea
            className="input compactTextarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional: estado general, hora de medicion, observaciones..."
          />
        </label>

        <div className="quickActions">
          <button className="btn primary" onClick={saveMeasurement} disabled={saving || !athleteId}>
            {saving ? "Guardando..." : "Guardar medicion"}
          </button>
          <button
            className="btn"
            onClick={() => {
              setValues({ ...EMPTY_VALUES });
              setNotes("");
              setMeasuredAt(toLocalInputValue(new Date()));
              setError("");
              setMsg("");
            }}
            disabled={saving}
          >
            Limpiar
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Medidas recomendadas</h3>
          <p>Catalogo de referencia para seguimiento de progreso fisico.</p>
        </div>
        <div className="gridCards" style={{ marginTop: 12 }}>
          {definitions.map((item) => (
            <article key={item.key} className="surfaceButton">
              <strong>{item.label}</strong>
              <span className="small">{`${item.key} (${item.unit})`}</span>
              <span className="small">{item.description}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Historico de mediciones</h3>
          <p>Ultimos registros ordenados por fecha de medicion.</p>
        </div>

        {loading ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Cargando historico...
          </div>
        ) : history.length === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Sin mediciones para este sujeto.
          </div>
        ) : (
          <div className="stack compactStack" style={{ marginTop: 12 }}>
            {history.map((item) => {
              const visibleMetrics: Array<{ label: string; value: string }> = [];
              for (const def of definitions) {
                const value = formatMetricValue(item, def.key, prefs.weightUnit);
                if (!value) continue;
                visibleMetrics.push({ label: def.label, value });
              }

              return (
                <article key={item.id} className="listItem">
                  <div className="listMain">
                    <strong>{new Date(item.measured_at).toLocaleString()}</strong>
                    <span className="small">{`IMC: ${typeof item.bmi === "number" ? item.bmi.toFixed(2) : "-"}`}</span>
                    <span className="small">
                      {`Cintura/estatura: ${
                        typeof item.waist_to_height_ratio === "number" ? item.waist_to_height_ratio.toFixed(3) : "-"
                      }`}
                    </span>
                  </div>
                  {visibleMetrics.length > 0 ? (
                    <div className="bodyMetricHistoryGrid">
                      {visibleMetrics.map((entry) => (
                        <span key={`${item.id}_${entry.label}`} className="chip">
                          {`${entry.label}: ${entry.value}`}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.notes ? <div className="small">{item.notes}</div> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
