import type { CycleLevel, CycleStatus } from "../../api";

export type PlanningTab = "micro" | "meso" | "macro" | "assignments" | "tracking";
export type BuilderLevel = "micro" | "meso" | "macro";
export type LinkLevel = "meso" | "macro";
export const CUSTOM_OBJECTIVE_PRESET_ID = "custom";

export type BuilderConfig = {
  name: string;
  objectivePresetId: string;
  objective: string;
  duration: number;
};

export type ObjectivePreset = {
  id: string;
  label: string;
  objective: string;
  trainingPhase?: string;
};

export type MicroSlot = {
  index: number;
  title: string;
  routineId: string;
};

export type LinkSlot = {
  index: number;
  childTemplateId: string;
};

export type MicroBuilder = {
  name: string;
  duration: number;
  slots: MicroSlot[];
};

export type LinkBuilder = BuilderConfig & {
  slots: LinkSlot[];
};

export const OBJECTIVE_PRESETS: ObjectivePreset[] = [
  {
    id: "hypertrophy",
    label: "Hipertrofia",
    objective: "Aumentar volumen útil con ejecución controlada.",
    trainingPhase: "hypertrophy",
  },
  {
    id: "strength",
    label: "Fuerza",
    objective: "Elevar fuerza máxima con enfasis técnico.",
    trainingPhase: "strength",
  },
  {
    id: "deload",
    label: "Descarga",
    objective: "Reducir fatiga acumulada sin perder patron técnico.",
    trainingPhase: "deload",
  },
  {
    id: "conditioning",
    label: "Acondicionamiento",
    objective: "Mejorar capacidad de trabajo y tolerancia al esfuerzo.",
    trainingPhase: "conditioning",
  },
  {
    id: "technique",
    label: "Técnica",
    objective: "Refinar patron motor, ritmo y estabilidad.",
    trainingPhase: "technique",
  },
  {
    id: CUSTOM_OBJECTIVE_PRESET_ID,
    label: "Personalizado",
    objective: "",
  },
];

export const OBJECTIVE_PRESET_MAP = new Map(OBJECTIVE_PRESETS.map((preset) => [preset.id, preset]));

export function levelLabel(level: CycleLevel): string {
  if (level === "micro") return "Microciclo";
  if (level === "meso") return "Mesociclo";
  return "Macrociclo";
}

export function statusLabel(status: CycleStatus): string {
  if (status === "draft") return "Draft";
  if (status === "active") return "Activo";
  if (status === "completed") return "Completado";
  return "Archivado";
}

// Nombre de la unidad hija de cada nivel (plural y singular).
export function unitLabelPlural(level: CycleLevel): string {
  return level === "micro" ? "Sesiones" : level === "meso" ? "Ciclos" : "Bloques";
}

export function unitLabelSingular(level: CycleLevel): string {
  return level === "micro" ? "Sesión" : level === "meso" ? "Ciclo" : "Bloque";
}

export function errorMessage(cause: unknown): string {
  return String((cause as { message?: string })?.message || cause);
}

export function defaultDurationForLevel(level: CycleLevel): number {
  if (level === "micro") return 7;
  if (level === "meso") return 6;
  return 6;
}

export function durationLabel(level: CycleLevel): string {
  if (level === "micro") return "Sesiones por ciclo";
  if (level === "meso") return "Ciclos por bloque";
  return "Bloques por plan";
}

export function defaultBuilderName(level: BuilderLevel): string {
  if (level === "micro") return "Nuevo microciclo";
  if (level === "meso") return "Nuevo mesociclo";
  return "Nuevo macrociclo";
}

function makeMicroSlots(duration: number): MicroSlot[] {
  return Array.from({ length: duration }, (_, idx) => ({
    index: idx + 1,
    title: `Sesión ${idx + 1}`,
    routineId: "",
  }));
}

function makeLinkSlots(duration: number): LinkSlot[] {
  return Array.from({ length: duration }, (_, idx) => ({
    index: idx + 1,
    childTemplateId: "",
  }));
}

export function resizeMicroSlots(slots: MicroSlot[], duration: number): MicroSlot[] {
  const byIndex = new Map(slots.map((slot) => [slot.index, slot]));
  return Array.from({ length: duration }, (_, idx) => {
    const index = idx + 1;
    const existing = byIndex.get(index);
    if (existing) return { ...existing, index };
    return {
      index,
      title: `Sesión ${index}`,
      routineId: "",
    };
  });
}

export function resizeLinkSlots(slots: LinkSlot[], duration: number): LinkSlot[] {
  const byIndex = new Map(slots.map((slot) => [slot.index, slot]));
  return Array.from({ length: duration }, (_, idx) => {
    const index = idx + 1;
    const existing = byIndex.get(index);
    if (existing) return { ...existing, index };
    return {
      index,
      childTemplateId: "",
    };
  });
}

export function buildBlankMicroBuilder(): MicroBuilder {
  const duration = defaultDurationForLevel("micro");
  return {
    name: defaultBuilderName("micro"),
    duration,
    slots: makeMicroSlots(duration),
  };
}

export function buildBlankLinkBuilder(level: "meso" | "macro"): LinkBuilder {
  const duration = defaultDurationForLevel(level);
  return {
    name: defaultBuilderName(level),
    objectivePresetId: CUSTOM_OBJECTIVE_PRESET_ID,
    objective: "",
    duration,
    slots: makeLinkSlots(duration),
  };
}

export function parseDurationInput(raw: string, fallback: number): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function builderFocusTag(builder: BuilderConfig): string | undefined {
  if (builder.objectivePresetId === CUSTOM_OBJECTIVE_PRESET_ID) {
    return builder.objective.trim() ? "custom" : undefined;
  }
  return builder.objectivePresetId;
}

export function builderTrainingPhase(builder: BuilderConfig): string | undefined {
  if (builder.objectivePresetId === CUSTOM_OBJECTIVE_PRESET_ID) return undefined;
  return OBJECTIVE_PRESET_MAP.get(builder.objectivePresetId)?.trainingPhase;
}
