import type { CSSProperties } from "react";

export const WELLNESS_MIN_SCORE = 1;

export const WELLNESS_MAX_SCORE = 10;

export const WELLNESS_STEP = 0.1;

export const WELLNESS_TICKS = Array.from(
  { length: WELLNESS_MAX_SCORE - WELLNESS_MIN_SCORE + 1 },
  (_, index) => WELLNESS_MIN_SCORE + index,
);

export const WELLNESS_LABEL_POINTS = [
  { score: 2, label: "muy malo" },
  { score: 4.5, label: "malo" },
  { score: 6.5, label: "bueno" },
  { score: 9, label: "excelente" },
] as const;

export const STRESS_LABEL_POINTS = [
  { score: 2, label: "bajo" },
  { score: 4.5, label: "medio-bajo" },
  { score: 6.5, label: "medio-alto" },
  { score: 9, label: "alto" },
] as const;

export function clampWellnessScore(value: number): number {
  if (!Number.isFinite(value)) return WELLNESS_MIN_SCORE;
  return Math.max(WELLNESS_MIN_SCORE, Math.min(WELLNESS_MAX_SCORE, value));
}

export function parseWellnessScore(rawValue: string): number {
  return Number(clampWellnessScore(Number(rawValue)).toFixed(1));
}

export function invertWellnessScore(score: number): number {
  return WELLNESS_MAX_SCORE + WELLNESS_MIN_SCORE - clampWellnessScore(score);
}

export function wellnessLabelFromScore(score: number): string {
  if (score >= 8) return "excelente";
  if (score >= 6) return "bueno";
  if (score >= 4) return "malo";
  return "muy malo";
}

export function stressLabelFromScore(score: number): string {
  if (score >= 8) return "alto";
  if (score >= 6) return "medio-alto";
  if (score >= 4) return "medio-bajo";
  return "bajo";
}

export function formatWellnessScore(score: number): string {
  return Number(clampWellnessScore(score).toFixed(1)).toFixed(1);
}

export function wellnessTickOffset(score: number): string {
  const ratio = (score - WELLNESS_MIN_SCORE) / (WELLNESS_MAX_SCORE - WELLNESS_MIN_SCORE);
  return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

export function stressSliderValue(score: number): number {
  return Number(invertWellnessScore(score).toFixed(1));
}

export function parseStressScore(rawValue: string): number {
  return Number(invertWellnessScore(parseWellnessScore(rawValue)).toFixed(1));
}

export function stressTickOffset(score: number): string {
  return wellnessTickOffset(invertWellnessScore(score));
}

export function wellnessProgress(score: number): string {
  const ratio = (clampWellnessScore(score) - WELLNESS_MIN_SCORE) / (WELLNESS_MAX_SCORE - WELLNESS_MIN_SCORE);
  return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

export function wellnessSliderStyle(score: number): CSSProperties {
  return { "--wellness-progress": wellnessProgress(score) } as CSSProperties;
}
