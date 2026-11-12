import type { FoodProduct } from "../../api";
import QuantityField from "../../components/QuantityField";
import type { FoodCategoryGroup } from "../../lib/nutrition/foodCategories";
import type { QuantityUnitKey } from "../../lib/nutrition/units";
import FoodRow from "./FoodRow";

// Buscador (atajos, categorias, resultados) y alta de alimento manual cuando no hay uno elegido.
export default function FoodBrowser({
  query,
  onQueryChange,
  activeCategory,
  categoryGroups,
  recentFoods,
  results,
  searching,
  onPickFood,
  onPickCategory,
  onScan,
  onPhoto,
  quantity,
  onQuantityChange,
  quantityUnit,
  onQuantityUnitChange,
  manualKcal,
  onManualKcalChange,
  manualProtein,
  onManualProteinChange,
  manualCarbs,
  onManualCarbsChange,
  manualFat,
  onManualFatChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  activeCategory: FoodCategoryGroup | null;
  categoryGroups: FoodCategoryGroup[];
  recentFoods: FoodProduct[];
  results: FoodProduct[];
  searching: boolean;
  onPickFood: (food: FoodProduct) => void;
  onPickCategory: (group: FoodCategoryGroup | null) => void;
  onScan: () => void;
  onPhoto: () => void;
  quantity: string;
  onQuantityChange: (value: string) => void;
  quantityUnit: QuantityUnitKey;
  onQuantityUnitChange: (unit: QuantityUnitKey) => void;
  manualKcal: string;
  onManualKcalChange: (value: string) => void;
  manualProtein: string;
  onManualProteinChange: (value: string) => void;
  manualCarbs: string;
  onManualCarbsChange: (value: string) => void;
  manualFat: string;
  onManualFatChange: (value: string) => void;
}) {
  // Los atajos (recientes + categorias) son la vista por defecto del buscador:
  // se van en cuanto hay algo que listar, para no apilar dos listas de comida.
  const showBrowse = !query.trim() && !activeCategory;

  return (
    <div className="stack compactStack">
      <div className="captureInputRow">
        <input
          className="input"
          placeholder={activeCategory ? `Buscar en ${activeCategory.label}...` : "Nombre del alimento..."}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button type="button" className="captureIconBtn" onClick={onScan} aria-label="Escanear código de barras">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7v10M8 7v10M12 7v10M16 7v10M20 7v10" />
          </svg>
        </button>
        <button type="button" className="captureIconBtn" onClick={onPhoto} aria-label="Registrar por foto">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>
      </div>

      {activeCategory ? (
        <div className="foodBrowseHead">
          <button type="button" className="chipButton" onClick={() => onPickCategory(null)}>
            ← Categorias
          </button>
          <span className="chip">
            <span className="foodEmoji" aria-hidden="true">
              {activeCategory.emoji}
            </span>
            {activeCategory.label}
          </span>
        </div>
      ) : null}

      {showBrowse && recentFoods.length > 0 ? (
        <div className="foodBrowseBlock">
          <span className="smallLabel">Recientes</span>
          <div className="stack compactStack">
            {recentFoods.map((food) => (
              <FoodRow key={food.id} food={food} onPick={onPickFood} />
            ))}
          </div>
        </div>
      ) : null}

      {showBrowse && categoryGroups.length > 0 ? (
        <div className="foodBrowseBlock">
          <span className="smallLabel">Categorias</span>
          <div className="foodCategoryGrid">
            {categoryGroups.map((group) => (
              <button
                key={group.key}
                type="button"
                className="foodCategoryTile"
                onClick={() => onPickCategory(group)}
              >
                <span className="foodCategoryEmoji" aria-hidden="true">
                  {group.emoji}
                </span>
                <span className="foodCategoryLabel">{group.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showBrowse ? null : searching ? (
        <div className="emptyState">Buscando...</div>
      ) : results.length > 0 ? (
        <div className="stack compactStack">
          {results.map((food) => (
            <FoodRow key={food.id} food={food} onPick={onPickFood} />
          ))}
        </div>
      ) : query.trim() ? (
        <div className="emptyState">Sin resultados para "{query.trim()}".</div>
      ) : (
        <div className="emptyState">Sin alimentos en {activeCategory?.label}.</div>
      )}

      {query.trim() ? (
        <div className="stack compactStack">
          <p className="small">No esta en el catálogo? Completa los datos y se registra como alimento manual.</p>
          <div className="bodyMetricGrid">
            <div className="bodyMetricField">
              <QuantityField
                value={quantity}
                onValueChange={onQuantityChange}
                unit={quantityUnit}
                onUnitChange={onQuantityUnitChange}
              />
            </div>
            <label className="bodyMetricField">
              <span className="smallLabel">Energía (kcal)</span>
              <input
                className="input"
                inputMode="decimal"
                value={manualKcal}
                onChange={(e) => onManualKcalChange(e.target.value)}
              />
            </label>
            <label className="bodyMetricField">
              <span className="smallLabel">Proteína (g)</span>
              <input
                className="input"
                inputMode="decimal"
                value={manualProtein}
                onChange={(e) => onManualProteinChange(e.target.value)}
              />
            </label>
            <label className="bodyMetricField">
              <span className="smallLabel">Carbohidratos (g)</span>
              <input
                className="input"
                inputMode="decimal"
                value={manualCarbs}
                onChange={(e) => onManualCarbsChange(e.target.value)}
              />
            </label>
            <label className="bodyMetricField">
              <span className="smallLabel">Grasas (g)</span>
              <input
                className="input"
                inputMode="decimal"
                value={manualFat}
                onChange={(e) => onManualFatChange(e.target.value)}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
