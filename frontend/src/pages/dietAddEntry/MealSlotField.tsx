import type { MealSlot } from "../../api";

type MealSlotOption = { key: MealSlot; label: string };

// Un solo campo para la comida destino, compartido por el modo busqueda y el
// modo foto: cerrado muestra a cual se registra, abierto deja cambiarla.
export default function MealSlotField({
  mealSlots,
  mealSlot,
  activeSlotLabel,
  open,
  onOpen,
  onPick,
}: {
  mealSlots: MealSlotOption[];
  mealSlot: MealSlot;
  activeSlotLabel: string;
  open: boolean;
  onOpen: () => void;
  onPick: (slot: MealSlot) => void;
}) {
  if (!open) {
    return (
      <div className="sectionHead">
        <h3>{activeSlotLabel}</h3>
        {mealSlots.length > 1 ? (
          <button type="button" className="btn btnSlim" onClick={onOpen}>
            Cambiar
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mealSlotPicker">
      {mealSlots.map((slot) => (
        <button
          key={slot.key}
          type="button"
          className={`mealSlotCard ${mealSlot === slot.key ? "activeMealSlotCard" : ""}`}
          onClick={() => onPick(slot.key)}
        >
          {slot.label}
        </button>
      ))}
    </div>
  );
}
