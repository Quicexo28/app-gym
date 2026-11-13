import { describe, expect, it } from "vitest";

import { toExerciseCatalogEntries } from "./exerciseCatalog";

const base = { family: "Fondos", variation: "Con Peso Corporal", scope: "global" as const, created_at_utc: "" };

describe("toExerciseCatalogEntries con ejercicios compuestos", () => {
  it("crea una entrada espejo por cada segundo musculo principal (peso 1)", () => {
    const entries = toExerciseCatalogEntries([
      { ...base, id: "f1", group: "Pecho", extra_muscles: [{ group: "Tríceps", weight: 1 }, { group: "Hombros", weight: 0.5 }] },
    ]);
    expect(entries.map((e) => [e.group, e.id, e.source_id])).toEqual([
      ["Pecho", "f1", "f1"],
      ["Tríceps", "f1@triceps", "f1"],
    ]);
    expect(entries[0].name).toBe(entries[1].name);
    expect(entries[1].path[0]).toBe("Tríceps");
  });

  it("no duplica en el grupo principal ni crea espejo para secundarios", () => {
    const entries = toExerciseCatalogEntries([
      { ...base, id: "x", group: "Pecho", extra_muscles: [{ group: "pecho", weight: 1 }, { group: "Hombros", weight: 0.5 }] },
      { ...base, id: "y", family: "Press", group: "Pecho" },
    ]);
    expect(entries.map((e) => e.id).sort()).toEqual(["x", "y"]);
  });
});
