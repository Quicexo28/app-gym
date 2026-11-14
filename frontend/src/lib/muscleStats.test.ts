import { describe, expect, it } from "vitest";

import type { SessionRecord } from "../api";
import { buildMuscleStats, estimateOneRm } from "./muscleStats";

const catalog = [
  { name: "Press banca", group: "Pecho", extra_muscles: [{ group: "Tríceps", weight: 0.5 }] },
  { name: "Aperturas", group: "Pecho" },
  { name: "Sentadilla", group: "Cuádriceps" },
];

function session(day: number, exercises: SessionRecord["exercises"], routine?: string): SessionRecord {
  return {
    athlete_id: "a",
    start_time: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`,
    duration_min: 60,
    rpe: 7,
    exercises,
    meta: routine ? { routine_name: routine } : undefined,
  };
}

describe("buildMuscleStats", () => {
  const sessions = [
    session(1, [{ name: "Press banca", sets: [{ reps: 5, load_kg: 80 }, { reps: 1, load_kg: 95 }] }], "Push"),
    session(8, [{ name: "Sentadilla", sets: [{ reps: 5, load_kg: 100 }] }], "Pierna"),
    session(15, [{ name: "Press banca", sets: [{ reps: 5, load_kg: 90 }] }, { name: "Aperturas", sets: [{ reps: 12, load_kg: 20 }] }], "Push"),
  ];
  const chest = buildMuscleStats(sessions, catalog, "pecho");

  it("lista solo sesiones con trabajo del grupo, la mas reciente primero", () => {
    expect(chest.recent.map((r) => r.routineName)).toEqual(["Push", "Push"]);
    expect(chest.recent[0].start_time).toContain("2026-10-15");
    expect(chest.totalSets).toBe(4);
  });

  it("separa 1RM real de 1RM calculado", () => {
    expect(chest.oneRmReal).toEqual([{ exercise: "Press banca", value: 95, detail: "1 repetición" }]);
    const est = chest.oneRmEstimated.find((e) => e.exercise === "Press banca");
    expect(est?.value).toBe(Math.round(estimateOneRm(5, 90) * 10) / 10);
  });

  it("mayor volumen en una sola serie", () => {
    expect(chest.bestSetVolume[0]).toMatchObject({ exercise: "Press banca", value: 450 });
  });

  it("mejora: compara primera sesion con la mejor", () => {
    const imp = chest.bestImprovement.find((e) => e.exercise === "Press banca");
    expect(imp?.value).toBeGreaterThan(0);
    expect(chest.bestImprovement.some((e) => e.exercise === "Aperturas")).toBe(false);
  });

  it("un secundario con peso 0.5 cuenta para tríceps", () => {
    expect(buildMuscleStats(sessions, catalog, "tricep").oneRmReal[0].exercise).toBe("Press banca");
  });

  it("grupo sin datos devuelve listas vacias", () => {
    const empty = buildMuscleStats(sessions, catalog, "lumbar");
    expect(empty.recent).toEqual([]);
    expect(empty.oneRmReal).toEqual([]);
  });
});
