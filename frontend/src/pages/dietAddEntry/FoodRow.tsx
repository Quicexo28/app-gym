import type { FoodProduct } from "../../api";
import { foodEmoji } from "../../lib/nutrition/foodEmoji";

export default function FoodRow({ food, onPick }: { food: FoodProduct; onPick: (food: FoodProduct) => void }) {
  return (
    <button type="button" className="surfaceButton" onClick={() => onPick(food)}>
      <strong>
        <span className="foodEmoji" aria-hidden="true">
          {foodEmoji(food.name, food.category)}
        </span>
        {food.name}
      </strong>
      <span className="small">
        {food.brand ? `${food.brand} | ` : ""}
        {food.energy_kcal !== null ? `${Math.round(food.energy_kcal)} kcal / 100 g` : "Sin datos"}
      </span>
    </button>
  );
}
