// Formato numérico compartido. Salida idéntica a las copias locales que reemplaza.

/** Redondea a un decimal. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Fracción a porcentaje con signo "+" si es positiva: 0.123 -> "+12.3%". */
export function asPct(value: number): string {
  const rounded = Math.round(value * 1000) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Kilos con un decimal, sin signo: 82.46 -> "82.5 kg". */
export function kg(value: number): string {
  return `${round1(value)} kg`;
}

/** Kilos con signo "+" si es positivo; "-" si es nulo. */
export function signedKg(value: number | null): string {
  if (value == null) return "-";
  const rounded = round1(value);
  return `${rounded > 0 ? "+" : ""}${rounded} kg`;
}
