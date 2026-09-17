// Helpers de fecha en horario local: la app agrupa entrenos por día calendario del usuario,
// no por UTC, para que una sesión de las 22:00 no aparezca en el día siguiente.

import { APP_LOCALE } from "./locale";

export const WEEKDAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const MONTHS_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return new Date();
  return new Date(year, month - 1, day);
}

/** Pasa un timestamp ISO (UTC o local) al día calendario local. */
export function isoToDayKey(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return dayKey(parsed);
}

/** Pasa un `target_date` de planificación (fecha suelta o ISO) al día calendario. */
export function planDateToDayKey(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Índice 0..6 con lunes = 0. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** "vie 25 jul" */
export function formatDayShort(date: Date): string {
  const weekday = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"][date.getDay()];
  return `${weekday} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** "jueves, 17 de septiembre" (siempre en español, ver `locale.ts`). */
export function formatDayLong(date: Date): string {
  try {
    return date.toLocaleDateString(APP_LOCALE, { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return formatDayShort(date);
  }
}

/** Rango "22 - 28 jul" para una ventana de `length` días que arranca en `start`. */
export function formatDayRange(start: Date, length = 7): string {
  const end = addDays(start, length - 1);
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = sameMonth
    ? String(start.getDate())
    : `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]}`;
  return `${startLabel} - ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`;
}

/** "Hoy" / "Ayer" / "Mañana" cuando aplica, si no null. */
export function relativeDayLabel(key: string, todayKey: string): string | null {
  if (key === todayKey) return "Hoy";
  const today = parseDayKey(todayKey);
  if (key === dayKey(addDays(today, -1))) return "Ayer";
  if (key === dayKey(addDays(today, 1))) return "Mañana";
  return null;
}

/** Valor para un input datetime-local en el día dado, conservando la hora actual. */
export function dayKeyToDatetimeLocal(key: string, reference: Date = new Date()): string {
  const hours = String(reference.getHours()).padStart(2, "0");
  const minutes = String(reference.getMinutes()).padStart(2, "0");
  return `${key}T${hours}:${minutes}`;
}
