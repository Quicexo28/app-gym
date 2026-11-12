import type { FoodProduct } from "../../api";
import QuantityField from "../../components/QuantityField";
import { foodEmoji } from "../../lib/nutrition/foodEmoji";
import { scalePer100g } from "../../lib/nutrition/dietApi";
import type { QuantityUnitKey } from "../../lib/nutrition/units";

export default function SelectedFoodCard({
  food,
  quantity,
  onQuantityChange,
  quantityUnit,
  onQuantityUnitChange,
  previewQty,
  baseQuantityHint,
  onClear,
}: {
  food: FoodProduct;
  quantity: string;
  onQuantityChange: (value: string) => void;
  quantityUnit: QuantityUnitKey;
  onQuantityUnitChange: (unit: QuantityUnitKey) => void;
  previewQty: number;
  baseQuantityHint: string | undefined;
  onClear: () => void;
}) {
  return (
    <div className="foodResultCard">
      <div className="foodResultHead">
        <strong>
          <span className="foodEmoji" aria-hidden="true">
            {foodEmoji(food.name, food.category)}
          </span>
          {food.name}
        </strong>
        <button type="button" className="btn btnSlim" onClick={onClear}>
          Cambiar
        </button>
      </div>
      {food.brand ? <span className="small">{food.brand}</span> : null}

      <QuantityField
        value={quantity}
        onValueChange={onQuantityChange}
        unit={quantityUnit}
        onUnitChange={onQuantityUnitChange}
        basis={food.basis}
        servingSizeG={food.serving_size_g}
        hint={quantityUnit === "g" || quantityUnit === "ml" ? undefined : baseQuantityHint}
      />

      <span className="small">
        {`Aprox: ${scalePer100g(food.energy_kcal, previewQty) ?? "—"} kcal | P ${scalePer100g(food.protein_g, previewQty) ?? "—"} g | C ${scalePer100g(food.carbs_g, previewQty) ?? "—"} g | G ${scalePer100g(food.fat_g, previewQty) ?? "—"} g`}
      </span>
    </div>
  );
}
