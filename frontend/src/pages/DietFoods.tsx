import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createDietFood,
  createDietEntriesFromPreset,
  deleteDietFood,
  deleteDietPreset,
  getDietFoodCategories,
  getDietPresets,
  searchDietFoods,
  type FoodProduct,
  type FoodScope,
  type MealPreset,
} from "../api";
import Select from "../components/Select";
import { genericMealSlotLabel, parseOptionalNumber } from "../lib/nutrition/dietApi";
import { foodEmoji } from "../lib/nutrition/foodEmoji";
import { useAthleteId } from "../state/athlete";
import { useAuth } from "../state/auth";

const ALL_CATEGORIES = "";

type MacroRangeField = "minKcal" | "maxKcal" | "minProtein" | "maxProtein" | "minCarbs" | "maxCarbs" | "minFat" | "maxFat";

const MACRO_RANGE_FIELDS: Array<{ field: MacroRangeField; label: string }> = [
  { field: "minKcal", label: "Kcal min" },
  { field: "maxKcal", label: "Kcal max" },
  { field: "minProtein", label: "Proteína min (g)" },
  { field: "maxProtein", label: "Proteína max (g)" },
  { field: "minCarbs", label: "Carbos min (g)" },
  { field: "maxCarbs", label: "Carbos max (g)" },
  { field: "minFat", label: "Grasas min (g)" },
  { field: "maxFat", label: "Grasas max (g)" },
];

const EMPTY_MACRO_RANGES: Record<MacroRangeField, string> = {
  minKcal: "",
  maxKcal: "",
  minProtein: "",
  maxProtein: "",
  minCarbs: "",
  maxCarbs: "",
  minFat: "",
  maxFat: "",
};

const SCOPE_OPTIONS: Array<{ value: FoodScope; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "mine", label: "Mios" },
  { value: "global", label: "Globales" },
];

type NewFoodForm = {
  name: string;
  brand: string;
  serving_size_g: string;
  energy_kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
};

const EMPTY_NEW_FOOD: NewFoodForm = {
  name: "",
  brand: "",
  serving_size_g: "",
  energy_kcal: "",
  protein_g: "",
  carbs_g: "",
  fat_g: "",
};

function macroSummary(food: FoodProduct): string {
  const parts: string[] = [];
  if (food.energy_kcal !== null) parts.push(`${Math.round(food.energy_kcal)} kcal`);
  if (food.protein_g !== null) parts.push(`P ${food.protein_g} g`);
  if (food.carbs_g !== null) parts.push(`C ${food.carbs_g} g`);
  if (food.fat_g !== null) parts.push(`G ${food.fat_g} g`);
  return parts.length > 0 ? `${parts.join(" | ")} / 100 g` : "Sin datos nutricionales";
}

export default function DietFoods() {
  const nav = useNavigate();
  const [athleteId] = useAthleteId();
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<FoodScope>("all");
  const [results, setResults] = useState<FoodProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [macroRanges, setMacroRanges] = useState<Record<MacroRangeField, string>>(EMPTY_MACRO_RANGES);

  const hasActiveFilters = category !== ALL_CATEGORIES || Object.values(macroRanges).some((v) => v.trim() !== "");

  function clearFilters() {
    setCategory(ALL_CATEGORIES);
    setMacroRanges(EMPTY_MACRO_RANGES);
  }

  const [showNewFood, setShowNewFood] = useState(false);
  const [newFood, setNewFood] = useState<NewFoodForm>(EMPTY_NEW_FOOD);
  const [savingFood, setSavingFood] = useState(false);
  const [foodMsg, setFoodMsg] = useState("");
  const [foodError, setFoodError] = useState("");

  const [presets, setPresets] = useState<MealPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState("");
  const [presetBusyId, setPresetBusyId] = useState<string | null>(null);
  const [presetMsg, setPresetMsg] = useState("");

  useEffect(() => {
    getDietFoodCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const term = query.trim();
    const filtersActive = term !== "" || hasActiveFilters;
    let cancelled = false;
    setSearching(true);
    setSearchError("");
    // Sin termino ni filtros se lista el catálogo del scope (para poder
    // explorarlo), con termino o filtro se debounce como una busqueda normal
    // y se pide un límite más alto para poder ver la categoria completa.
    const timeoutId = window.setTimeout(
      () => {
        searchDietFoods({
          q: term,
          scope,
          category: category || undefined,
          min_kcal: parseOptionalNumber(macroRanges.minKcal) ?? undefined,
          max_kcal: parseOptionalNumber(macroRanges.maxKcal) ?? undefined,
          min_protein: parseOptionalNumber(macroRanges.minProtein) ?? undefined,
          max_protein: parseOptionalNumber(macroRanges.maxProtein) ?? undefined,
          min_carbs: parseOptionalNumber(macroRanges.minCarbs) ?? undefined,
          max_carbs: parseOptionalNumber(macroRanges.maxCarbs) ?? undefined,
          min_fat: parseOptionalNumber(macroRanges.minFat) ?? undefined,
          max_fat: parseOptionalNumber(macroRanges.maxFat) ?? undefined,
          limit: filtersActive ? 200 : 40,
        })
          .then((rows) => {
            if (!cancelled) setResults(rows);
          })
          .catch((cause: unknown) => {
            if (cancelled) return;
            setResults([]);
            setSearchError(String((cause as { message?: string })?.message || cause));
          })
          .finally(() => {
            if (!cancelled) setSearching(false);
          });
      },
      filtersActive ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, category, macroRanges]);

  function loadPresets() {
    setPresetsLoading(true);
    setPresetsError("");
    getDietPresets()
      .then(setPresets)
      .catch((cause: unknown) => setPresetsError(String((cause as { message?: string })?.message || cause)))
      .finally(() => setPresetsLoading(false));
  }

  useEffect(() => {
    loadPresets();
  }, []);

  async function removeFood(food: FoodProduct) {
    if (!window.confirm(`Eliminar "${food.name}"?`)) return;
    try {
      await deleteDietFood(food.id);
      setResults((prev) => prev.filter((item) => item.id !== food.id));
    } catch (cause: unknown) {
      setSearchError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function saveNewFood() {
    setSavingFood(true);
    setFoodError("");
    setFoodMsg("");
    try {
      const name = newFood.name.trim();
      if (!name) {
        setFoodError("El nombre es obligatorio.");
        return;
      }
      await createDietFood({
        name,
        brand: newFood.brand.trim() || null,
        serving_size_g: parseOptionalNumber(newFood.serving_size_g),
        energy_kcal: parseOptionalNumber(newFood.energy_kcal),
        protein_g: parseOptionalNumber(newFood.protein_g),
        carbs_g: parseOptionalNumber(newFood.carbs_g),
        fat_g: parseOptionalNumber(newFood.fat_g),
      });
      setFoodMsg("Alimento personalizado creado.");
      setNewFood(EMPTY_NEW_FOOD);
      setShowNewFood(false);
    } catch (cause: unknown) {
      setFoodError(String((cause as { message?: string })?.message || cause));
    } finally {
      setSavingFood(false);
    }
  }

  async function registerFromPreset(preset: MealPreset) {
    if (!athleteId) return;
    setPresetBusyId(preset.id);
    setPresetMsg("");
    setPresetsError("");
    try {
      await createDietEntriesFromPreset({
        athlete_id: athleteId,
        preset_id: preset.id,
        meal_slot: preset.meal_slot,
      });
      setPresetMsg(`"${preset.name}" registrado en el día de hoy.`);
    } catch (cause: unknown) {
      setPresetsError(String((cause as { message?: string })?.message || cause));
    } finally {
      setPresetBusyId(null);
    }
  }

  async function removePreset(preset: MealPreset) {
    if (!window.confirm(`Eliminar la preestablecida "${preset.name}"?`)) return;
    try {
      await deleteDietPreset(preset.id);
      setPresets((prev) => prev.filter((item) => item.id !== preset.id));
    } catch (cause: unknown) {
      setPresetsError(String((cause as { message?: string })?.message || cause));
    }
  }

  return (
    <>
      <section className="surface">
        <div className="sectionHead">
          <h3>Buscar alimentos</h3>
          <p>Catálogo compartido y tus alimentos personalizados.</p>
        </div>

        <div className="stack compactStack" style={{ marginTop: 12 }}>
          <input
            className="input"
            placeholder="Buscar por nombre..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="hstack compact" style={{ justifyContent: "space-between" }}>
            <div className="chipRow">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`chipButton ${scope === option.value ? "activeChipButton" : ""}`}
                  onClick={() => setScope(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`btn btnSlim ${hasActiveFilters ? "primary" : ""}`}
              onClick={() => setShowFilters((prev) => !prev)}
            >
              {showFilters ? "Ocultar filtros" : hasActiveFilters ? "Filtros (activos)" : "Filtros"}
            </button>
          </div>

          {showFilters ? (
            <div className="stack compactStack" style={{ marginTop: 4 }}>
              <label>
                <span className="smallLabel">Categoria</span>
                <Select
                  value={category}
                  onChange={setCategory}
                  placeholder="Todas"
                  options={[
                    { value: ALL_CATEGORIES, label: "Todas" },
                    ...categories.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </label>
              <div className="bodyMetricGrid">
                {MACRO_RANGE_FIELDS.map(({ field, label }) => (
                  <label className="bodyMetricField" key={field}>
                    <span className="smallLabel">{label}</span>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={macroRanges[field]}
                      onChange={(e) => setMacroRanges((prev) => ({ ...prev, [field]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              {hasActiveFilters ? (
                <button type="button" className="btn btnSlim" onClick={clearFilters}>
                  Limpiar filtros
                </button>
              ) : null}
            </div>
          ) : null}

          {searchError ? <div className="message error">{searchError}</div> : null}

          {searching ? (
            <div className="emptyState">Buscando...</div>
          ) : results.length === 0 ? (
            <div className="emptyState">
              {query.trim() || hasActiveFilters
                ? "Sin resultados para esta busqueda/filtros."
                : "Aún no hay alimentos en el catálogo."}
            </div>
          ) : (
            <div className="stack compactStack">
              {results.map((food) => (
                <article key={food.id} className="foodResultCard">
                  <div className="foodResultHead">
                    <strong>
                      <span className="foodEmoji" aria-hidden="true">
                        {foodEmoji(food.name, food.category)}
                      </span>
                      {food.name}
                    </strong>
                    {food.status === "pending" ? <span className="chip foodPendingChip">Sin verificar</span> : null}
                  </div>
                  {food.brand || food.category ? (
                    <span className="small">{[food.brand, food.category].filter(Boolean).join(" · ")}</span>
                  ) : null}
                  <span className="small">{macroSummary(food)}</span>
                  {food.source === "tcac" ? (
                    <span className="small">Fuente: TCAC 2018 - ICBF</span>
                  ) : null}
                  <div className="hstack compact">
                    <button
                      className="btn primary"
                      onClick={() => nav("/diet/agregar", { state: { food } })}
                      disabled={!athleteId}
                    >
                      Agregar
                    </button>
                    {food.owner_user_id && food.owner_user_id === user?.id ? (
                      <button className="btn" onClick={() => void removeFood(food)}>
                        Eliminar
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead homeHead">
          <h3>Alimentos personalizados</h3>
          <button className="btn btnSlim" onClick={() => setShowNewFood((prev) => !prev)}>
            {showNewFood ? "Cancelar" : "Nuevo"}
          </button>
        </div>

        {foodMsg ? <div className="message" style={{ marginTop: 12 }}>{foodMsg}</div> : null}
        {foodError ? <div className="message error" style={{ marginTop: 12 }}>{foodError}</div> : null}

        {showNewFood ? (
          <div className="stack compactStack" style={{ marginTop: 12 }}>
            <label>
              <span className="smallLabel">Nombre</span>
              <input
                className="input"
                value={newFood.name}
                onChange={(e) => setNewFood((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Ej. Arepa de maiz"
              />
            </label>
            <label>
              <span className="smallLabel">Marca (opcional)</span>
              <input
                className="input"
                value={newFood.brand}
                onChange={(e) => setNewFood((prev) => ({ ...prev, brand: e.target.value }))}
              />
            </label>
            <div className="bodyMetricGrid">
              <label className="bodyMetricField">
                <span className="smallLabel">Porcion (g)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={newFood.serving_size_g}
                  onChange={(e) => setNewFood((prev) => ({ ...prev, serving_size_g: e.target.value }))}
                  placeholder="100"
                />
              </label>
              <label className="bodyMetricField">
                <span className="smallLabel">Energía (kcal / 100 g)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={newFood.energy_kcal}
                  onChange={(e) => setNewFood((prev) => ({ ...prev, energy_kcal: e.target.value }))}
                />
              </label>
              <label className="bodyMetricField">
                <span className="smallLabel">Proteína (g / 100 g)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={newFood.protein_g}
                  onChange={(e) => setNewFood((prev) => ({ ...prev, protein_g: e.target.value }))}
                />
              </label>
              <label className="bodyMetricField">
                <span className="smallLabel">Carbos (g / 100 g)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={newFood.carbs_g}
                  onChange={(e) => setNewFood((prev) => ({ ...prev, carbs_g: e.target.value }))}
                />
              </label>
              <label className="bodyMetricField">
                <span className="smallLabel">Grasas (g / 100 g)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={newFood.fat_g}
                  onChange={(e) => setNewFood((prev) => ({ ...prev, fat_g: e.target.value }))}
                />
              </label>
            </div>
            <div className="quickActions">
              <button className="btn primary" onClick={() => void saveNewFood()} disabled={savingFood}>
                {savingFood ? "Guardando..." : "Guardar alimento"}
              </button>
            </div>
          </div>
        ) : (
          <p className="small" style={{ marginTop: 12 }}>
            Crea un alimento propio cuando no lo encuentres en el catálogo.
          </p>
        )}
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Comidas preestablecidas</h3>
          <p>Registra varios alimentos de una vez.</p>
        </div>

        {presetMsg ? <div className="message" style={{ marginTop: 12 }}>{presetMsg}</div> : null}
        {presetsError ? <div className="message error" style={{ marginTop: 12 }}>{presetsError}</div> : null}

        <div className="stack compactStack" style={{ marginTop: 12 }}>
          {presetsLoading ? (
            <div className="emptyState">Cargando preestablecidas...</div>
          ) : presets.length === 0 ? (
            <div className="emptyState">Aún no tienes comidas preestablecidas.</div>
          ) : (
            presets.map((preset) => (
              <div key={preset.id} className="mealEntryRow">
                <div className="mealEntryInfo">
                  <strong>{preset.name}</strong>
                  <span className="small">
                    {`${preset.items.length} alimentos${preset.meal_slot ? ` | ${genericMealSlotLabel(preset.meal_slot)}` : ""}`}
                  </span>
                </div>
                <div className="hstack compact">
                  <button
                    className="btn btnSlim"
                    onClick={() => void registerFromPreset(preset)}
                    disabled={presetBusyId === preset.id || !athleteId}
                  >
                    {presetBusyId === preset.id ? "..." : "Registrar"}
                  </button>
                  <button className="btn btnSlim" onClick={() => void removePreset(preset)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
