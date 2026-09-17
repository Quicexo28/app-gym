import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  getDietSummary,
  putDietTargets,
  type DietSummaryDayItem,
  type NutritionTarget,
} from "../api";
import { DietTrendChart, MacroBar, MicroBar, ProgressRing } from "../components/NutritionCharts";
import { addDays, dayKey, formatDayLong, formatDayShort, parseDayKey, relativeDayLabel } from "../lib/dates";
import {
  energyFromMacros,
  parseOptionalNumber,
  solveMissingMacro,
  targetsToPayload,
  todayKey,
  useDietToday,
  useMicronutrientRegistry,
  type MacroFieldKey,
  type MacroValues,
} from "../lib/nutrition/dietApi";
import { useAthleteId } from "../state/athlete";

const WEEK_DAYS = 7;

type FieldKey = MacroFieldKey | "fiber_g";

const MACRO_FIELDS: Array<{ key: MacroFieldKey; label: string; unit: string }> = [
  { key: "energy_kcal", label: "Calorías", unit: "kcal" },
  { key: "protein_g", label: "Proteína", unit: "g" },
  { key: "carbs_g", label: "Carbohidratos", unit: "g" },
  { key: "fat_g", label: "Grasas", unit: "g" },
];

const EMPTY_FORM: Record<FieldKey, string> = {
  energy_kcal: "",
  protein_g: "",
  carbs_g: "",
  fat_g: "",
  fiber_g: "",
};

function formToValues(target: NutritionTarget | null): Record<FieldKey, string> {
  if (!target) return { ...EMPTY_FORM };
  const next = { ...EMPTY_FORM };
  for (const key of Object.keys(EMPTY_FORM) as FieldKey[]) {
    const value = target[key];
    next[key] = value === null || value === undefined ? "" : String(value);
  }
  return next;
}

/** Los 7 días que terminan en el día seleccionado (el rango "semanal" de esta pantalla). */
function useDietWeek(athleteId: string, selectedKey: string) {
  const [days, setDays] = useState<DietSummaryDayItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fromKey = useMemo(() => dayKey(addDays(parseDayKey(selectedKey), -(WEEK_DAYS - 1))), [selectedKey]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!athleteId) {
        if (!cancelled) setDays([]);
        return;
      }
      if (!cancelled) setLoading(true);
      try {
        const res = await getDietSummary(athleteId, fromKey, selectedKey);
        if (!cancelled) setDays(res.days);
      } catch {
        if (!cancelled) setDays([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, fromKey, selectedKey]);

  return { days, loading };
}

export default function DietNutrition() {
  const [athleteId] = useAthleteId();
  const nav = useNavigate();
  const location = useLocation();

  const todayK = todayKey();
  const selectedKey = new URLSearchParams(location.search).get("day") || todayK;
  const selectedDate = parseDayKey(selectedKey);
  const relativeLabel = relativeDayLabel(selectedKey, todayK);

  const { targets, totals, loading, error, refresh } = useDietToday(athleteId, selectedKey);
  const week = useDietWeek(athleteId, selectedKey);
  const { registry } = useMicronutrientRegistry();

  // Objetivos vive aquí dentro (antes era la pestana `/diet/objetivos`): se
  // abre desde esta misma pantalla, sobre los números que se estan mirando.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<FieldKey, string>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [msg, setMsg] = useState("");

  function openEditor() {
    setForm(formToValues(targets));
    setSaveError("");
    setMsg("");
    setEditing(true);
  }

  const macroValues: MacroValues = useMemo(
    () => ({
      energy_kcal: parseOptionalNumber(form.energy_kcal),
      protein_g: parseOptionalNumber(form.protein_g),
      carbs_g: parseOptionalNumber(form.carbs_g),
      fat_g: parseOptionalNumber(form.fat_g),
    }),
    [form.energy_kcal, form.protein_g, form.carbs_g, form.fat_g],
  );

  // Con 3 de los 4 valores el cuarto sale solo (4 kcal/g proteína y carbos,
  // 9 kcal/g grasa): no se pide, se muestra calculado y se guarda así.
  const solved = useMemo(() => solveMissingMacro(macroValues), [macroValues]);

  const macrosKcal =
    macroValues.protein_g !== null && macroValues.carbs_g !== null && macroValues.fat_g !== null
      ? Math.round(energyFromMacros(macroValues.protein_g, macroValues.carbs_g, macroValues.fat_g))
      : null;

  async function saveTargets() {
    if (!athleteId) return;
    setSaving(true);
    setSaveError("");
    setMsg("");
    try {
      const values: Record<MacroFieldKey, number | null> = { ...macroValues };
      if (solved) values[solved.key] = solved.value;
      await putDietTargets(
        targetsToPayload(athleteId, targets, {
          energy_kcal: values.energy_kcal,
          protein_g: values.protein_g,
          carbs_g: values.carbs_g,
          fat_g: values.fat_g,
          fiber_g: parseOptionalNumber(form.fiber_g),
        }),
      );
      refresh();
      setEditing(false);
      setMsg("Objetivos guardados.");
    } catch (cause: unknown) {
      setSaveError(String((cause as { message?: string })?.message || cause));
    } finally {
      setSaving(false);
    }
  }

  const energyTarget = targets?.energy_kcal || 0;
  const energyValue = totals?.energy_kcal || 0;
  const energyPct = energyTarget > 0 ? (energyValue / energyTarget) * 100 : 0;

  /** Micros del día: objetivo personalizado si existe, si no la RDA del registro. */
  const microRows = useMemo(() => {
    const consumed = totals?.micronutrients || {};
    return registry
      .map((def) => ({
        def,
        value: consumed[def.key] || 0,
        target: targets?.micronutrient_targets?.[def.key] ?? def.rda,
      }))
      .filter((row) => row.target > 0);
  }, [registry, targets, totals]);

  const loggedDays = useMemo(() => week.days.filter((day) => day.totals.energy_kcal > 0), [week.days]);

  const weekAvg = useMemo(() => {
    if (loggedDays.length === 0) return null;
    const sum = (pick: (day: DietSummaryDayItem) => number) =>
      loggedDays.reduce((acc, day) => acc + pick(day), 0) / loggedDays.length;
    return {
      energy_kcal: Math.round(sum((day) => day.totals.energy_kcal)),
      protein_g: Math.round(sum((day) => day.totals.protein_g)),
      carbs_g: Math.round(sum((day) => day.totals.carbs_g)),
      fat_g: Math.round(sum((day) => day.totals.fat_g)),
      fiber_g: Math.round(sum((day) => day.totals.fiber_g)),
    };
  }, [loggedDays]);

  /** Promedio de micros sobre los días con registros (comparar contra el objetivo diario). */
  const weekMicroRows = useMemo(() => {
    if (loggedDays.length === 0) return [];
    return registry
      .map((def) => ({
        def,
        value: loggedDays.reduce((acc, day) => acc + (day.totals.micronutrients[def.key] || 0), 0) / loggedDays.length,
        target: targets?.micronutrient_targets?.[def.key] ?? def.rda,
      }))
      .filter((row) => row.target > 0);
  }, [registry, targets, loggedDays]);

  const chartPoints = useMemo(
    () =>
      week.days.map((day) => ({
        label: formatDayShort(parseDayKey(day.date)),
        value: Math.round(day.totals.energy_kcal),
      })),
    [week.days],
  );

  return (
    <div className="container stack">
      <header className="titleBlock">
        <button type="button" className="linkBtn" onClick={() => nav(`/diet?day=${selectedKey}`)}>
          ‹ Volver
        </button>
        <h1>Nutrición</h1>
        <p className="small">
          {relativeLabel ? `${relativeLabel} - ` : ""}
          {formatDayLong(selectedDate)}
        </p>
      </header>

      {error ? <section className="message error">{error}</section> : null}
      {msg ? <section className="message">{msg}</section> : null}

      {/* Objetivos: antes era una pestana aparte, ahora se ajusta aquí mismo. */}
      <section className="surface">
        <div className="sectionHead homeHead">
          <h3>Objetivos</h3>
          <button type="button" className="linkBtn" onClick={() => (editing ? setEditing(false) : openEditor())} disabled={!athleteId}>
            {editing ? "Cancelar" : "Ajustar"}
          </button>
        </div>

        {editing ? (
          <div className="stack compactStack" style={{ marginTop: 12 }}>
            <div className="bodyMetricGrid">
              {MACRO_FIELDS.map((field) => {
                const auto = solved?.key === field.key ? solved.value : null;
                return (
                  <label key={field.key} className="bodyMetricField">
                    <span className="smallLabel">{field.label}</span>
                    <div className="bodyMetricInputRow">
                      <input
                        className="input"
                        value={form[field.key]}
                        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        inputMode="decimal"
                        placeholder={auto !== null ? String(auto) : "0"}
                      />
                      <span className="chip">{field.unit}</span>
                    </div>
                    {auto !== null ? <span className="small">{`Calculado: ${auto} ${field.unit}`}</span> : null}
                  </label>
                );
              })}
              <label className="bodyMetricField">
                <span className="smallLabel">Fibra</span>
                <div className="bodyMetricInputRow">
                  <input
                    className="input"
                    value={form.fiber_g}
                    onChange={(e) => setForm((prev) => ({ ...prev, fiber_g: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0"
                  />
                  <span className="chip">g</span>
                </div>
              </label>
            </div>

            <p className="small">
              {solved
                ? "Deja un campo vacio y se calcula con 4 kcal/g de proteína y carbos, 9 kcal/g de grasa."
                : macrosKcal !== null
                  ? `Los macros suman ${macrosKcal} kcal.`
                  : "Llena 3 de los 4 y el que falte se calcula solo."}
            </p>

            {saveError ? <div className="message error">{saveError}</div> : null}

            <div className="quickActions">
              <button className="btn primary" onClick={() => void saveTargets()} disabled={saving}>
                {saving ? "Guardando..." : "Guardar objetivos"}
              </button>
            </div>
          </div>
        ) : (
          <div className="statsGrid" style={{ marginTop: 12 }}>
            <article className="statCard">
              <div className="smallLabel">Calorías</div>
              <strong>{energyTarget > 0 ? `${energyTarget} kcal` : "—"}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Proteína</div>
              <strong>{targets?.protein_g ? `${targets.protein_g} g` : "—"}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Carbohidratos</div>
              <strong>{targets?.carbs_g ? `${targets.carbs_g} g` : "—"}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Grasas</div>
              <strong>{targets?.fat_g ? `${targets.fat_g} g` : "—"}</strong>
            </article>
          </div>
        )}
      </section>

      <section className="surface">
        <div className="sectionHead homeHead">
          <h2>Diario</h2>
          <span className="chip">{formatDayShort(selectedDate)}</span>
        </div>

        {loading ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Cargando día...
          </div>
        ) : (
          <>
            <div className="dietBody" style={{ marginTop: 12 }}>
              <ProgressRing pct={energyPct} center={String(Math.round(energyValue))} caption="kcal" />
              <div className="macroStack">
                <MacroBar label="Proteína" value={Math.round(totals?.protein_g || 0)} target={targets?.protein_g || 0} unit="g" />
                <MacroBar label="Carbos" value={Math.round(totals?.carbs_g || 0)} target={targets?.carbs_g || 0} unit="g" />
                <MacroBar label="Grasas" value={Math.round(totals?.fat_g || 0)} target={targets?.fat_g || 0} unit="g" />
                <MacroBar label="Fibra" value={Math.round(totals?.fiber_g || 0)} target={targets?.fiber_g || 0} unit="g" />
              </div>
            </div>

            <h4 style={{ marginTop: 18 }}>Micronutrientes</h4>
            {microRows.length > 0 ? (
              <div className="microGrid" style={{ marginTop: 10 }}>
                {microRows.map((row) => (
                  <MicroBar
                    key={row.def.key}
                    label={row.def.label}
                    value={row.value}
                    target={row.target}
                    unit={row.def.unit}
                    hasUpperLimit={row.def.upper_limit !== null}
                  />
                ))}
              </div>
            ) : (
              <div className="emptyState" style={{ marginTop: 10 }}>
                Sin datos de micronutrientes.
              </div>
            )}
          </>
        )}
      </section>

      <section className="surface">
        <div className="sectionHead homeHead">
          <h2>Semanal</h2>
          <span className="chip">{`${loggedDays.length}/${WEEK_DAYS} días`}</span>
        </div>

        {week.loading ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Cargando semana...
          </div>
        ) : (
          <>
            <div className="statsGrid" style={{ marginTop: 12 }}>
              <article className="statCard">
                <div className="smallLabel">Promedio kcal</div>
                <strong>{weekAvg ? `${weekAvg.energy_kcal} kcal` : "Sin datos"}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">Promedio proteína</div>
                <strong>{weekAvg ? `${weekAvg.protein_g} g` : "Sin datos"}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">Promedio carbos</div>
                <strong>{weekAvg ? `${weekAvg.carbs_g} g` : "Sin datos"}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">Promedio grasas</div>
                <strong>{weekAvg ? `${weekAvg.fat_g} g` : "Sin datos"}</strong>
              </article>
            </div>

            <div style={{ marginTop: 14 }}>
              <DietTrendChart points={chartPoints} target={energyTarget > 0 ? energyTarget : null} unit="kcal" />
            </div>

            {weekAvg ? (
              <div className="macroStack" style={{ marginTop: 14 }}>
                <MacroBar label="Proteína" value={weekAvg.protein_g} target={targets?.protein_g || 0} unit="g" />
                <MacroBar label="Carbos" value={weekAvg.carbs_g} target={targets?.carbs_g || 0} unit="g" />
                <MacroBar label="Grasas" value={weekAvg.fat_g} target={targets?.fat_g || 0} unit="g" />
                <MacroBar label="Fibra" value={weekAvg.fiber_g} target={targets?.fiber_g || 0} unit="g" />
              </div>
            ) : null}

            <h4 style={{ marginTop: 18 }}>Micronutrientes (promedio diario)</h4>
            {weekMicroRows.length > 0 ? (
              <div className="microGrid" style={{ marginTop: 10 }}>
                {weekMicroRows.map((row) => (
                  <MicroBar
                    key={row.def.key}
                    label={row.def.label}
                    value={row.value}
                    target={row.target}
                    unit={row.def.unit}
                    hasUpperLimit={row.def.upper_limit !== null}
                  />
                ))}
              </div>
            ) : (
              <div className="emptyState" style={{ marginTop: 10 }}>
                Aún no hay días registrados en esta semana.
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
