import { useEffect } from "react";

import Select from "./Select";
import {
  defaultUnitForBasis,
  quantityUnitDef,
  unitsForFood,
  type QuantityUnitKey,
} from "../lib/nutrition/units";
import type { FoodBasis } from "../api";

type QuantityFieldProps = {
  /** Texto crudo del input (se parsea afuera, para aceptar coma decimal mientras se escribe). */
  value: string;
  onValueChange: (value: string) => void;
  unit: QuantityUnitKey;
  onUnitChange: (unit: QuantityUnitKey) => void;
  /** Base del alimento: decide si se ofrecen unidades de masa o de volumen. */
  basis?: FoodBasis | null;
  /** Gramos de una porcion; sin esto no se ofrece la unidad "porcion". */
  servingSizeG?: number | null;
  label?: string;
  /** Línea de apoyo debajo (p.ej. el equivalente en gramos, o los macros aprox). */
  hint?: string;
  disabled?: boolean;
};

/**
 * Cantidad consumida = número + unidad, en una sola línea.
 *
 * Las unidades disponibles dependen del alimento (`unitsForFood`), así que el
 * selector nunca ofrece "litros" para un solido ni "porciones" para algo cuyo
 * tamano de porcion no se conoce. Si la unidad activa deja de estar disponible
 * -- pasa al cambiar de alimento, o al marcar como liquido algo que estaba en
 * gramos -- se corrige hacia arriba a la unidad base, para que lo que se ve en
 * el selector y lo que se guarda no se separen nunca.
 */
export default function QuantityField({
  value,
  onValueChange,
  unit,
  onUnitChange,
  basis,
  servingSizeG,
  label = "Cantidad",
  hint,
  disabled,
}: QuantityFieldProps) {
  const units = unitsForFood({ basis, servingSizeG });
  const activeIsAvailable = units.some((option) => option.key === unit);
  const activeUnit = activeIsAvailable ? unit : defaultUnitForBasis(basis);
  const activeLabel = quantityUnitDef(activeUnit)?.label ?? activeUnit;

  useEffect(() => {
    if (!activeIsAvailable) onUnitChange(activeUnit);
  }, [activeIsAvailable, activeUnit, onUnitChange]);

  return (
    <div className="quantityField">
      <span className="smallLabel">{label}</span>
      <div className="quantityFieldRow">
        <input
          className="input quantityFieldInput"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          aria-label={`${label} (${activeLabel})`}
          onChange={(e) => onValueChange(e.target.value)}
        />
        <Select
          className="quantityFieldUnit"
          ariaLabel="Unidad"
          value={activeUnit}
          disabled={disabled}
          onChange={(next) => onUnitChange(next as QuantityUnitKey)}
          options={units.map((option) => ({ value: option.key, label: option.label }))}
        />
      </div>
      {hint ? <span className="small">{hint}</span> : null}
    </div>
  );
}
