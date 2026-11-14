import { formatExerciseNameForList } from "../exerciseTree";
import { APP_LOCALE } from "../locale";
import type { NotificationCapability } from "./types";

export function normalizeExerciseNameForNotes(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function toISOZ(datetimeLocal: string): string {
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

export function deviceDatetimeLocal(): string {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

export function formatStartLabel(datetimeLocal: string): string {
  if (!datetimeLocal) return "Sin fecha de inicio";
  const parsed = new Date(datetimeLocal);
  if (Number.isNaN(parsed.getTime())) return datetimeLocal.replace("T", " ");
  return parsed.toLocaleString(APP_LOCALE, { dateStyle: "medium", timeStyle: "short" });
}

export function formatRepsRange(min: number, max: number): string {
  if (min === max) return String(min);
  return `${min}-${max}`;
}

export function formatRestRecommendation(restSeconds: number): string {
  if (restSeconds <= 0) return "Sin descanso";
  return `${restSeconds}s`;
}

export function formatExerciseNameForCard(name: string): string {
  return formatExerciseNameForList(name);
}

export function detectNotificationCapability(): NotificationCapability {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}
