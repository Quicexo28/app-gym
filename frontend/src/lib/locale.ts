/**
 * Locale único de la app. La UI esta escrita en español, así que las fechas y
 * números no pueden depender del idioma del dispositivo: en un teléfono o
 * navegador en ingles `toLocaleDateString(undefined, ...)` devolvia
 * "Thursday, September 17" dentro de una pantalla en español.
 */
export const APP_LOCALE = "es-CO";

/** "jue, 17 de septiembre" */
export function formatDateLong(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(APP_LOCALE, { weekday: "long", day: "numeric", month: "long" });
}

/** "17/09/2026" */
export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(APP_LOCALE);
}

/** "17 sept 2026" */
export function formatDateMedium(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(APP_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

/** "17/09/2026, 5:25 p. m." */
export function formatDateTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(APP_LOCALE, { dateStyle: "medium", timeStyle: "short" });
}

/** "5:25 p. m." */
export function formatTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(APP_LOCALE, { hour: "2-digit", minute: "2-digit" });
}
