import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  createDietEntry,
  deleteDietEntry,
  getDietSummary,
  putDietTargets,
  updateDietEntry,
  type MealEntry,
  type MealSlot,
} from "../api";
import KebabMenu from "../components/KebabMenu";
import QuantityField from "../components/QuantityField";
import { MacroBar, ProgressRing } from "../components/NutritionCharts";
import { Sparkline } from "../components/Charts";
import SwipeToDeleteRow from "../components/SwipeToDeleteRow";
import WeekDayPicker from "../components/WeekDayPicker";
import { addDays, dayKey, formatDayLong, parseDayKey, relativeDayLabel } from "../lib/dates";
import { foodEmoji } from "../lib/nutrition/foodEmoji";
import {
  MAX_MEAL_COUNT,
  defaultMealLabel,
  mealEntryToCreatePayload,
  mealLabelsFromTargets,
  mealSlotsFromTargets,
  parseOptionalNumber,
  resolveMealLabel,
  targetsToPayload,
  todayKey,
  useDietToday,
  type MealSlotDef,
} from "../lib/nutrition/dietApi";
import {
  basisFromUnit,
  defaultUnitForBasis,
  formatQuantity,
  quantityUnitDef,
  toBaseQuantity,
  type QuantityUnitKey,
} from "../lib/nutrition/units";
import { useAthleteId } from "../state/athlete";
import { useUndo } from "../state/undo";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

type WeekPoint = { day: string; kcal: number };

/** Últimos 7 días de kcal registradas: solo lo justo para la vista previa de tendencia. */
function useDietWeekTrend(athleteId: string) {
  const [points, setPoints] = useState<WeekPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!athleteId) {
        if (!cancelled) setPoints([]);
        return;
      }
      if (!cancelled) setLoading(true);
      try {
        const today = parseDayKey(todayKey());
        const fromKey = dayKey(addDays(today, -6));
        const res = await getDietSummary(athleteId, fromKey, todayKey());
        if (cancelled) return;
        setPoints(res.days.map((day) => ({ day: day.date, kcal: Math.round(day.totals.energy_kcal) })));
      } catch {
        if (!cancelled) setPoints([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const loggedDays = useMemo(() => points.filter((point) => point.kcal > 0), [points]);
  const avgKcal = loggedDays.length > 0 ? Math.round(loggedDays.reduce((acc, point) => acc + point.kcal, 0) / loggedDays.length) : 0;

  return { points, loading, avgKcal, loggedCount: loggedDays.length };
}

/** kcal por día de la semana visible en el `WeekDayPicker` (se refetch al cambiar de semana), para pintar el punto "done". */
function useVisibleWeekKcal(athleteId: string, selectedKey: string) {
  const [kcalByDay, setKcalByDay] = useState<Map<string, number>>(new Map());

  const selectedDate = useMemo(() => parseDayKey(selectedKey), [selectedKey]);
  const fromKey = useMemo(() => dayKey(addDays(selectedDate, -3)), [selectedDate]);
  const toKey = useMemo(() => dayKey(addDays(selectedDate, 3)), [selectedDate]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!athleteId) {
        if (!cancelled) setKcalByDay(new Map());
        return;
      }
      try {
        const res = await getDietSummary(athleteId, fromKey, toKey);
        if (cancelled) return;
        setKcalByDay(new Map(res.days.map((day) => [day.date, day.totals.energy_kcal])));
      } catch {
        if (!cancelled) setKcalByDay(new Map());
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, fromKey, toKey]);

  return kcalByDay;
}

export default function DietToday() {
  const [athleteId] = useAthleteId();
  const nav = useNavigate();
  const location = useLocation();
  const { registerUndo } = useUndo();

  const todayK = todayKey();
  const urlDayKey = new URLSearchParams(location.search).get("day") || todayK;

  const [selectedKey, setSelectedKey] = useState(urlDayKey);
  // Router no remonta el componente al pasar de /diet?day=X a /diet (misma
  // ruta): sin este ancla, entrar por el menu inferior tras haber navegado un
  // día distinto desde el card de Home se quedaba pegado en ese día viejo.
  // Patron recomendado por React para "resetear estado cuando cambia una prop"
  // (ajustar durante el render, no en un efecto).
  const [syncedUrlDayKey, setSyncedUrlDayKey] = useState(urlDayKey);
  if (urlDayKey !== syncedUrlDayKey) {
    setSyncedUrlDayKey(urlDayKey);
    setSelectedKey(urlDayKey);
  }

  const { targets, entries, totals, loading, error, refresh } = useDietToday(athleteId, selectedKey);
  const weekTrend = useDietWeekTrend(athleteId);
  const weekKcal = useVisibleWeekKcal(athleteId, selectedKey);

  // Edición de nombres de comidas en línea: el nombre vive en `meal_labels` de
  // los objetivos, pero se cambia desde la card, no en otra pantalla.
  const [editingSlot, setEditingSlot] = useState<MealSlot | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [mealsError, setMealsError] = useState("");

  // Corregir cuanto se comio se hace tocando el alimento en la misma lista, no
  // borrando y volviendo a registrar. La unidad se puede cambiar de paso: es
  // comun anotar "100 g" a ojo y después querer decir "1 porcion".
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryQuantity, setEntryQuantity] = useState("");
  const [entryUnit, setEntryUnit] = useState<QuantityUnitKey>("g");
  const [entrySaving, setEntrySaving] = useState(false);

  const selectedDate = useMemo(() => parseDayKey(selectedKey), [selectedKey]);
  const relativeLabel = relativeDayLabel(selectedKey, todayK);

  const entriesBySlot = useMemo(() => {
    const map = new Map<MealSlot, MealEntry[]>();
    for (const entry of entries) {
      const bucket = map.get(entry.meal_slot);
      if (bucket) bucket.push(entry);
      else map.set(entry.meal_slot, [entry]);
    }
    return map;
  }, [entries]);

  const activeSlots = useMemo(() => mealSlotsFromTargets(targets), [targets]);

  // Comidas configuradas primero, en orden; cualquier entry con un slot ya no
  // configurado (p.ej. una comida extra agregada solo hoy) igual se ve, al final.
  const orderedSlots = useMemo(() => {
    const seen = new Set(activeSlots.map((slot) => slot.key));
    const extra: MealSlotDef[] = [];
    for (const slot of entriesBySlot.keys()) {
      if (seen.has(slot)) continue;
      seen.add(slot);
      extra.push({ key: slot, label: resolveMealLabel(slot, activeSlots) });
    }
    return [...activeSlots, ...extra];
  }, [activeSlots, entriesBySlot]);

  const canAddMeal = activeSlots.length < MAX_MEAL_COUNT;

  async function persistMealLabels(nextLabels: string[]) {
    if (!athleteId) return;
    setMealsError("");
    try {
      await putDietTargets(targetsToPayload(athleteId, targets, { meal_labels: nextLabels }));
      refresh();
    } catch (cause: unknown) {
      setMealsError(String((cause as { message?: string })?.message || cause));
    }
  }

  function startRename(slot: MealSlotDef) {
    setEditingSlot(slot.key);
    setDraftLabel(slot.label);
  }

  async function commitRename(slot: MealSlotDef) {
    const index = activeSlots.findIndex((item) => item.key === slot.key);
    const next = draftLabel.trim();
    setEditingSlot(null);
    if (index < 0 || !next || next === slot.label) return;
    const labels = mealLabelsFromTargets(targets);
    labels[index] = next;
    await persistMealLabels(labels);
  }

  async function handleAddMeal() {
    const labels = mealLabelsFromTargets(targets);
    if (labels.length >= MAX_MEAL_COUNT) return;
    await persistMealLabels([...labels, defaultMealLabel(labels.length)]);
  }

  /** Borra la comida de la configuración y, si tenia alimentos ese día, también esos registros. */
  async function handleDeleteMeal(slot: MealSlotDef) {
    const index = activeSlots.findIndex((item) => item.key === slot.key);
    if (index < 0) return;
    const previousLabels = mealLabelsFromTargets(targets);
    if (previousLabels.length <= 1) {
      setMealsError("Deja al menos una comida.");
      return;
    }
    const slotEntries = entriesBySlot.get(slot.key) || [];

    await Promise.all(slotEntries.map((entry) => deleteDietEntry(entry.id)));
    await persistMealLabels(previousLabels.filter((_, idx) => idx !== index));

    registerUndo({
      message: `"${slot.label}" eliminada.`,
      onUndo: async () => {
        await persistMealLabels(previousLabels);
        await Promise.all(slotEntries.map((entry) => createDietEntry(mealEntryToCreatePayload(entry))));
        refresh();
      },
    });
  }

  function goToAddFood(slot: MealSlot) {
    const params = new URLSearchParams({ day: selectedKey, slot });
    nav(`/diet/agregar?${params.toString()}`);
  }

  /**
   * Gramos de una porcion de este alimento, deducidos de la propia entrada.
   *
   * La entrada no guarda el `serving_size_g` del catálogo, pero si se registro
   * en porciones la división lo recupera exacto. Sin ese dato no se ofrece la
   * unidad "porcion" al editar, que es justo lo que hace `unitsForFood`.
   */
  function servingSizeFromEntry(entry: MealEntry): number | null {
    if (entry.quantity_unit === "porcion" && entry.quantity_value) {
      return entry.quantity_g / entry.quantity_value;
    }
    return null;
  }

  function startEditEntry(entry: MealEntry) {
    setMealsError("");
    setEditingEntryId(entry.id);
    setEntryUnit(quantityUnitDef(entry.quantity_unit)?.key ?? defaultUnitForBasis(null));
    setEntryQuantity(String(entry.quantity_value ?? entry.quantity_g));
  }

  async function commitEntryQuantity(entry: MealEntry) {
    const qty = parseOptionalNumber(entryQuantity);
    const servingSizeG = servingSizeFromEntry(entry);
    if (!qty || toBaseQuantity(qty, entryUnit, servingSizeG) === null) {
      setMealsError("Cantidad no válida.");
      return;
    }
    setEntrySaving(true);
    setMealsError("");
    try {
      await updateDietEntry(entry.id, { quantity_value: qty, quantity_unit: entryUnit });
      setEditingEntryId(null);
      refresh();
    } catch (cause: unknown) {
      setMealsError(String((cause as { message?: string })?.message || cause));
    } finally {
      setEntrySaving(false);
    }
  }

  async function handleDeleteEntry(entry: MealEntry) {
    await deleteDietEntry(entry.id);
    refresh();
    registerUndo({
      message: `"${entry.food_name}" eliminado.`,
      onUndo: async () => {
        await createDietEntry(mealEntryToCreatePayload(entry));
        refresh();
      },
    });
  }

  async function handleRemoveMeal(slot: MealSlotDef) {
    const slotEntries = entriesBySlot.get(slot.key) || [];
    if (slotEntries.length === 0) return;
    await Promise.all(slotEntries.map((entry) => deleteDietEntry(entry.id)));
    refresh();
    registerUndo({
      message: `"${slot.label}" vaciada de ${relativeLabel || formatDayLong(selectedDate)}.`,
      onUndo: async () => {
        await Promise.all(slotEntries.map((entry) => createDietEntry(mealEntryToCreatePayload(entry))));
        refresh();
      },
    });
  }

  const energyTarget = targets?.energy_kcal || 0;
  const energyValue = totals?.energy_kcal || 0;
  const energyPct = energyTarget > 0 ? (energyValue / energyTarget) * 100 : 0;
  const energyLeft = Math.round(energyTarget - energyValue);
  const loggedMeals = orderedSlots.filter((slot) => (entriesBySlot.get(slot.key) || []).length > 0).length;

  return (
    <>
      <header className="homeHeader">
        <div className="homeDate">
          <span className="homeDateDay">{formatDayLong(selectedDate)}</span>
          <span className="homeDateMeta small">
            {relativeLabel ? `${relativeLabel} - ` : ""}
            {selectedDate.getFullYear()}
          </span>
        </div>
      </header>

      <WeekDayPicker
        selectedKey={selectedKey}
        todayKey={todayK}
        onSelect={setSelectedKey}
        getMarks={(key) => ({ done: (weekKcal.get(key) ?? 0) > 0 })}
      />

      {error ? <section className="message error">{error}</section> : null}

      {/* Sin título: la card ES el resumen del día. Al pulsarla se abre el
          detalle nutricional (diario + semanal) y ahi se ajustan objetivos. */}
      <button
        type="button"
        className="surface cardButton"
        onClick={() => nav(`/diet/nutricion?day=${selectedKey}`)}
        disabled={!athleteId}
      >
        <div className="sectionHead homeHead">
          {!loading && energyTarget > 0 ? (
            <span className="chip">{energyLeft >= 0 ? `Faltan ${energyLeft} kcal` : `+${Math.abs(energyLeft)} kcal`}</span>
          ) : (
            <span className="small">{loading ? "Cargando..." : "Sin objetivo de kcal"}</span>
          )}
          <span className="cardChevron" aria-hidden="true">
            ›
          </span>
        </div>

        {loading ? null : (
          <div className="dietBody">
            <ProgressRing pct={energyPct} center={String(Math.round(energyValue))} caption="kcal" />
            <div className="macroStack">
              <MacroBar label="Proteína" value={round1(totals?.protein_g || 0)} target={targets?.protein_g || 0} unit="g" />
              <MacroBar label="Carbos" value={round1(totals?.carbs_g || 0)} target={targets?.carbs_g || 0} unit="g" />
              <MacroBar label="Grasas" value={round1(totals?.fat_g || 0)} target={targets?.fat_g || 0} unit="g" />
            </div>
          </div>
        )}
      </button>

      {/* Una sola card para todo el día (misma densidad que la card de Entreno en
          Home): cada comida es un bloque separado por una línea, no una card
          propia con cajas dentro. */}
      {!loading ? (
        <section className="surface">
          <div className="sectionHead homeHead">
            <h3>Comidas</h3>
            <span className="chip">{`${loggedMeals}/${orderedSlots.length}`}</span>
          </div>

          <div className="mealGroups">
            {orderedSlots.map((slot) => {
              const slotEntries = entriesBySlot.get(slot.key) || [];
              const slotKcal = Math.round(slotEntries.reduce((acc, item) => acc + (item.energy_kcal || 0), 0));
              const configured = activeSlots.some((item) => item.key === slot.key);

              return (
                <div key={slot.key} className="mealGroup">
                  <div className="mealGroupHead">
                    {editingSlot === slot.key ? (
                      <input
                        className="input mealNameInput"
                        value={draftLabel}
                        onChange={(e) => setDraftLabel(e.target.value)}
                        onBlur={() => void commitRename(slot)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingSlot(null);
                        }}
                        maxLength={40}
                        aria-label={`Nombre de ${slot.label}`}
                        autoFocus
                      />
                    ) : (
                      <h4>{slot.label}</h4>
                    )}
                    <div className="hstack compact">
                      {slotEntries.length > 0 ? <span className="chip">{`${slotKcal} kcal`}</span> : null}
                      <KebabMenu
                        ariaLabel={`Opciones de ${slot.label}`}
                        actions={[
                          ...(configured ? [{ label: "Renombrar", onSelect: () => startRename(slot) }] : []),
                          ...(slotEntries.length > 0
                            ? [
                                {
                                  label: "Vaciar este día",
                                  destructive: true,
                                  onSelect: () => void handleRemoveMeal(slot),
                                },
                              ]
                            : []),
                          ...(configured
                            ? [
                                {
                                  label: "Eliminar comida",
                                  destructive: true,
                                  onSelect: () => void handleDeleteMeal(slot),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                  </div>

                  {slotEntries.length > 0 ? (
                    <div className="mealFoodList">
                      {slotEntries.map((entry) => (
                        <div key={entry.id} className="mealFoodRow">
                          {editingEntryId === entry.id ? (
                            <div className="mealFoodEdit">
                              <span className="mealFoodName">
                                <span className="foodEmoji" aria-hidden="true">
                                  {foodEmoji(entry.food_name)}
                                </span>
                                {entry.food_name}
                              </span>
                              <QuantityField
                                label="Cantidad"
                                value={entryQuantity}
                                onValueChange={setEntryQuantity}
                                unit={entryUnit}
                                onUnitChange={setEntryUnit}
                                basis={basisFromUnit(entry.quantity_unit)}
                                servingSizeG={servingSizeFromEntry(entry)}
                                disabled={entrySaving}
                              />
                              <div className="quickActions">
                                <button
                                  type="button"
                                  className="btn btnSlim primary"
                                  onClick={() => void commitEntryQuantity(entry)}
                                  disabled={entrySaving}
                                >
                                  {entrySaving ? "Guardando..." : "Guardar"}
                                </button>
                                <button
                                  type="button"
                                  className="btn btnSlim"
                                  onClick={() => setEditingEntryId(null)}
                                  disabled={entrySaving}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <SwipeToDeleteRow onDelete={() => void handleDeleteEntry(entry)}>
                              <button
                                type="button"
                                className="mealFoodRowInner mealFoodRowButton"
                                onClick={() => startEditEntry(entry)}
                                aria-label={`Cambiar cantidad de ${entry.food_name}`}
                              >
                                <span className="mealFoodName">
                                  <span className="foodEmoji" aria-hidden="true">
                                    {foodEmoji(entry.food_name)}
                                  </span>
                                  {entry.food_name}
                                </span>
                                <span className="small mealFoodMeta">
                                  {`${formatQuantity(entry)}${entry.energy_kcal !== null ? ` - ${Math.round(entry.energy_kcal)} kcal` : ""}`}
                                </span>
                              </button>
                            </SwipeToDeleteRow>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="small">Sin alimentos aún.</span>
                  )}

                  <button type="button" className="linkBtn" onClick={() => goToAddFood(slot.key)} disabled={!athleteId}>
                    + Agregar alimento
                  </button>
                </div>
              );
            })}
          </div>

          {mealsError ? <div className="message error" style={{ marginTop: 12 }}>{mealsError}</div> : null}

          {canAddMeal ? (
            <div className="quickActions mealsCardActions">
              <button type="button" className="btn btnSlim" onClick={() => void handleAddMeal()} disabled={!athleteId}>
                + Agregar comida
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Mismo patron que las cards de Pasos/Peso en Home: valor en la cabecera,
          gráfica sin ejes debajo. */}
      <button
        type="button"
        className="surface cardButton"
        onClick={() => nav("/diet/historial")}
        disabled={!athleteId}
      >
        <div className="sectionHead homeHead">
          <h3>Tendencia</h3>
          <div className="hstack compact">
            <span className={weekTrend.loggedCount > 0 ? "cardValue" : "mutedValue"}>
              {weekTrend.loggedCount > 0 ? `${weekTrend.avgKcal} kcal` : "—"}
            </span>
            <span className="cardChevron" aria-hidden="true">
              ›
            </span>
          </div>
        </div>

        {weekTrend.loading ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Cargando tendencia...
          </div>
        ) : (
          <>
            <div style={{ marginTop: 10 }}>
              <Sparkline values={weekTrend.points.map((point) => point.kcal)} />
            </div>
            <div className="small" style={{ marginTop: 8 }}>
              {`Promedio 7 días - ${weekTrend.loggedCount}/7 días registrados`}
            </div>
          </>
        )}
      </button>
    </>
  );
}
