export { formatRepsRange, formatRestRecommendation as formatRestSeconds } from "../session/format";
import { formatSetsRange } from "../storage";
import type { RoutineExerciseTemplate, RoutineTemplate } from "../storage";
import {
  inferLegacyExerciseGroup,
  normalizeGroupLabel,
  normalizeLookupText,
} from "./draft";

export type RoutineGroupSeries = {
  group: string;
  sets: number;
  ratio: number;
};

export function compactLabel(value: string, limit = 14): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(1, limit - 1)).trimEnd()}...`;
}

export function radarLabelAnchor(labelX: number, center: number): "start" | "middle" | "end" {
  if (labelX < center - 8) return "end";
  if (labelX > center + 8) return "start";
  return "middle";
}

function normalizeSetTarget(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(30, Math.round(value)));
}

function totalSeries(exercises: Array<{ target_sets_min: number; target_sets_max: number }>): {
  min: number;
  max: number;
} {
  return exercises.reduce(
    (acc, exercise) => ({
      min: acc.min + normalizeSetTarget(exercise.target_sets_min),
      max: acc.max + normalizeSetTarget(exercise.target_sets_max),
    }),
    { min: 0, max: 0 },
  );
}

function formatTotalSeries(exercises: Array<{ target_sets_min: number; target_sets_max: number }>): string {
  const { min, max } = totalSeries(exercises);
  return formatSetsRange(min, max);
}

/** "4 ejercicios · 12-15 series": una linea en vez de una pila de chips. */
export function routineSummaryLine(routine: RoutineTemplate): string {
  const count = routine.exercises.length;
  const exercisesLabel = `${count} ejercicio${count === 1 ? "" : "s"}`;
  if (count === 0) return exercisesLabel;
  return `${exercisesLabel} · ${formatTotalSeries(routine.exercises)} series`;
}

function resolveExerciseGroup(
  exercise: Pick<RoutineExerciseTemplate, "name" | "group">,
  catalogGroupByName: Map<string, string>,
): string {
  const explicitGroup = normalizeGroupLabel(exercise.group);
  if (explicitGroup) return explicitGroup;
  const fromLegacy = inferLegacyExerciseGroup(exercise.name);
  if (fromLegacy) return fromLegacy;
  return catalogGroupByName.get(normalizeLookupText(exercise.name)) || "Sin grupo";
}

export function buildRoutineSeriesByGroup(
  routine: RoutineTemplate,
  catalogGroupByName: Map<string, string>,
): RoutineGroupSeries[] {
  const grouped = new Map<string, number>();
  for (const exercise of routine.exercises) {
    const sets = normalizeSetTarget(exercise.target_sets_max);
    if (sets <= 0) continue;
    const group = resolveExerciseGroup(exercise, catalogGroupByName);
    grouped.set(group, (grouped.get(group) || 0) + sets);
  }

  const total = Array.from(grouped.values()).reduce((acc, sets) => acc + sets, 0);
  return Array.from(grouped.entries())
    .map(([group, sets]) => ({
      group,
      sets,
      ratio: total > 0 ? sets / total : 0,
    }))
    .sort((a, b) => {
      if (b.sets !== a.sets) return b.sets - a.sets;
      return a.group.localeCompare(b.group);
    });
}

export function buildRoutineRadar(seriesByGroup: RoutineGroupSeries[], maxSeries: number) {
  if (seriesByGroup.length === 0) return null;

  const chartSize = 340;
  const center = chartSize / 2;
  const radius = 112;
  const ringCount = 4;
  const angleStep = (Math.PI * 2) / seriesByGroup.length;

  const axes = seriesByGroup.map((entry, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const axisX = center + Math.cos(angle) * radius;
    const axisY = center + Math.sin(angle) * radius;
    const labelRadius = radius + 20;
    const labelX = center + Math.cos(angle) * labelRadius;
    const labelY = center + Math.sin(angle) * labelRadius;

    return {
      ...entry,
      angle,
      axisX,
      axisY,
      labelX,
      labelY,
    };
  });

  const rings = Array.from({ length: ringCount }, (_, ringIndex) => {
    const ringFactor = (ringIndex + 1) / ringCount;
    return axes
      .map((axis) => {
        const x = center + Math.cos(axis.angle) * radius * ringFactor;
        const y = center + Math.sin(axis.angle) * radius * ringFactor;
        return `${x},${y}`;
      })
      .join(" ");
  });

  const valuePolygon = axes
    .map((axis) => {
      const valueRadius = radius * (axis.sets / maxSeries);
      const x = center + Math.cos(axis.angle) * valueRadius;
      const y = center + Math.sin(axis.angle) * valueRadius;
      return `${x},${y}`;
    })
    .join(" ");

  return {
    chartSize,
    center,
    axes,
    rings,
    valuePolygon,
  };
}

export type RoutineRadar = NonNullable<ReturnType<typeof buildRoutineRadar>>;
