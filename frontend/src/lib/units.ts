import type { WeightUnit } from "../state/preferences";

const KG_PER_LB = 0.45359237;

export function toKg(weight: number, unit: WeightUnit): number {
  if (!Number.isFinite(weight)) return 0;
  return unit === "lb" ? weight * KG_PER_LB : weight;
}

export function fromKg(weightKg: number, unit: WeightUnit): number {
  if (!Number.isFinite(weightKg)) return 0;
  return unit === "lb" ? weightKg / KG_PER_LB : weightKg;
}

export function formatWeight(weightKg: number, unit: WeightUnit): string {
  const converted = fromKg(weightKg, unit);
  const rounded = converted >= 100 ? Math.round(converted) : Number(converted.toFixed(1));
  return `${rounded} ${unit}`;
}
