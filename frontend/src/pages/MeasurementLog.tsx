import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { createBodyMeasurement, type BodyMeasurementCreatePayload, type BodyMetricKey } from "../api";
import DatePicker from "../components/DatePicker";
import TimePicker from "../components/TimePicker";
import {
  buildDefinitionByKey,
  EMPTY_VALUES,
  FIELD_GROUPS,
  parseOptionalNumber,
  toLocalInputValue,
  useBodyMeasurements,
} from "../lib/bodyMetrics";
import { useAthleteId } from "../state/athlete";

const VALID_KEYS = new Set<string>(FIELD_GROUPS.flatMap((group) => group.keys));

export default function MeasurementLog() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [athleteId] = useAthleteId();
  const { definitions } = useBodyMeasurements(athleteId);
  const definitionByKey = useMemo(() => buildDefinitionByKey(definitions), [definitions]);

  const requestedKey = searchParams.get("key") || "";
  const singleKey: BodyMetricKey | null = VALID_KEYS.has(requestedKey) ? (requestedKey as BodyMetricKey) : null;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [measuredAt, setMeasuredAt] = useState<string>(() => toLocalInputValue(new Date()));
  const [notes, setNotes] = useState("");
  const [values, setValues] = useState<Record<BodyMetricKey, string>>(EMPTY_VALUES);

  const [measuredDatePart, measuredTimePart] = useMemo(() => {
    const [datePart, timePart] = measuredAt.split("T");
    return [datePart || "", timePart || "00:00"];
  }, [measuredAt]);

  function setMeasuredDatePart(next: string): void {
    setMeasuredAt(`${next}T${measuredTimePart}`);
  }

  function setMeasuredTimePart(next: string): void {
    setMeasuredAt(`${measuredDatePart}T${next}`);
  }

  function setFieldValue(key: BodyMetricKey, next: string): void {
    setValues((prev) => ({ ...prev, [key]: next }));
  }

  function goBack() {
    navigate(singleKey ? `/profile/progress/medida/${singleKey}` : "/profile/progress");
  }

  async function save() {
    if (!athleteId) return;
    setSaving(true);
    setError("");
    setMsg("");

    try {
      const payload: BodyMeasurementCreatePayload = { athlete_id: athleteId };

      if (measuredAt.trim()) {
        const parsed = new Date(measuredAt);
        if (Number.isNaN(parsed.getTime())) {
          setError("La fecha/hora es invalida.");
          return;
        }
        payload.measured_at = parsed.toISOString();
      }

      let anyMetric = false;
      const keysToRead = singleKey ? [singleKey] : (Object.keys(values) as BodyMetricKey[]);
      for (const key of keysToRead) {
        const value = parseOptionalNumber(values[key]);
        if (value === null) continue;
        payload[key] = value;
        anyMetric = true;
      }

      if (!anyMetric) {
        setError("Debes ingresar un valor numerico.");
        return;
      }

      const cleanNotes = notes.trim();
      if (cleanNotes) payload.notes = cleanNotes;

      await createBodyMeasurement(payload);
      setMsg("Medición guardada.");
      setTimeout(() => goBack(), 400);
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
            autoFocus={singleKey === key}
          />
          <span className="chip">{info.unit}</span>
        </div>
      </label>
    );
  }

  const singleInfo = singleKey ? definitionByKey.get(singleKey) : null;

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}
      {msg ? <section className="message">{msg}</section> : null}

      <section className="surface stack compactStack">
        <div className="sectionHead">
          <h3>{singleInfo ? `Registrar: ${singleInfo.label}` : "Nueva medición"}</h3>
          {singleInfo ? <p>Solo se guarda esta medida; el resto de tu histórico no cambia.</p> : null}
        </div>

        <div className="splitGrid">
          <DatePicker label="Fecha" value={measuredDatePart} onChange={setMeasuredDatePart} />
          <TimePicker label="Hora" value={measuredTimePart} onChange={setMeasuredTimePart} />
        </div>

        {singleKey ? (
          <div className="bodyMetricGrid">{renderInput(singleKey)}</div>
        ) : (
          FIELD_GROUPS.map((group) => (
            <article key={group.title} className="bodyMetricGroup">
              <div className="sectionHead">
                <h4>{group.title}</h4>
              </div>
              <div className="bodyMetricGrid">{group.keys.map((key) => renderInput(key))}</div>
            </article>
          ))
        )}

        <label>
          <span className="smallLabel">Notas</span>
          <textarea
            className="input compactTextarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional: estado general, hora de medición, observaciones..."
          />
        </label>

        <div className="quickActions">
          <button className="btn primary" onClick={() => void save()} disabled={saving || !athleteId}>
            {saving ? "Guardando..." : "Guardar medición"}
          </button>
          <button className="btn" onClick={goBack} disabled={saving}>
            Cancelar
          </button>
        </div>
      </section>
    </>
  );
}
