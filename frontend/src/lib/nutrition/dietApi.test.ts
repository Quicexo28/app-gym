import { describe, expect, it } from "vitest";

import {
  defaultMealLabel,
  energyFromMacros,
  mealSlotsFromTargets,
  solveMissingMacro,
  targetsToPayload,
  type MacroValues,
} from "./dietApi";
import type { NutritionTarget } from "../../api";

function makeTargets(overrides: Partial<NutritionTarget> = {}): NutritionTarget {
  return {
    athlete_id: "athlete_1",
    energy_kcal: 2000,
    protein_g: 150,
    carbs_g: 200,
    fat_g: 60,
    fiber_g: 30,
    micronutrient_targets: { iron_mg: 18 },
    meal_labels: ["Desayuno propio", "Comida 2"],
    updated_at_utc: null,
    ...overrides,
  };
}

function macros(values: Partial<MacroValues>): MacroValues {
  return { energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, ...values };
}

describe("energyFromMacros", () => {
  it("aplica 4 kcal/g a proteina y carbos, 9 kcal/g a grasa", () => {
    expect(energyFromMacros(150, 200, 60)).toBe(150 * 4 + 200 * 4 + 60 * 9);
  });
});

describe("solveMissingMacro", () => {
  it("deduce las kcal cuando faltan (redondeadas al entero)", () => {
    expect(solveMissingMacro(macros({ protein_g: 150, carbs_g: 200, fat_g: 60 }))).toEqual({
      key: "energy_kcal",
      value: 1940,
    });
  });

  it("deduce el macro que falta despejando la ecuacion", () => {
    expect(solveMissingMacro(macros({ energy_kcal: 1940, carbs_g: 200, fat_g: 60 }))).toEqual({
      key: "protein_g",
      value: 150,
    });
    expect(solveMissingMacro(macros({ energy_kcal: 1940, protein_g: 150, fat_g: 60 }))).toEqual({
      key: "carbs_g",
      value: 200,
    });
    expect(solveMissingMacro(macros({ energy_kcal: 1940, protein_g: 150, carbs_g: 200 }))).toEqual({
      key: "fat_g",
      value: 60,
    });
  });

  it("redondea los gramos a un decimal", () => {
    expect(solveMissingMacro(macros({ energy_kcal: 2000, protein_g: 150, carbs_g: 200 }))).toEqual({
      key: "fat_g",
      value: 66.7,
    });
  });

  it("null si no falta exactamente un valor", () => {
    expect(solveMissingMacro(macros({ energy_kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }))).toBeNull();
    expect(solveMissingMacro(macros({ energy_kcal: 2000, protein_g: 150 }))).toBeNull();
    expect(solveMissingMacro(macros({}))).toBeNull();
  });

  it("null si los macros ya se pasan de las kcal (el faltante daria negativo)", () => {
    expect(solveMissingMacro(macros({ energy_kcal: 500, protein_g: 150, carbs_g: 200 }))).toBeNull();
  });

  it("null si algun valor no es finito", () => {
    expect(solveMissingMacro(macros({ energy_kcal: Number.NaN, protein_g: 150, carbs_g: 200 }))).toBeNull();
  });
});

describe("mealSlotsFromTargets", () => {
  it("usa los nombres configurados, con ids estables `comida_N`", () => {
    expect(mealSlotsFromTargets(makeTargets())).toEqual([
      { key: "comida_1", label: "Desayuno propio" },
      { key: "comida_2", label: "Comida 2" },
    ]);
  });

  it("sin `meal_labels` cae en 3 comidas genericas", () => {
    expect(mealSlotsFromTargets(makeTargets({ meal_labels: null }))).toEqual([
      { key: "comida_1", label: defaultMealLabel(0) },
      { key: "comida_2", label: defaultMealLabel(1) },
      { key: "comida_3", label: defaultMealLabel(2) },
    ]);
  });
});

describe("targetsToPayload", () => {
  it("conserva el resto de la fila al cambiar un solo campo (PUT reemplaza todo)", () => {
    const payload = targetsToPayload("athlete_1", makeTargets(), { meal_labels: ["Solo una"] });
    expect(payload).toEqual({
      athlete_id: "athlete_1",
      energy_kcal: 2000,
      protein_g: 150,
      carbs_g: 200,
      fat_g: 60,
      fiber_g: 30,
      micronutrient_targets: { iron_mg: 18 },
      meal_labels: ["Solo una"],
    });
  });

  it("sin objetivos previos manda nulls explicitos", () => {
    expect(targetsToPayload("athlete_1", null)).toEqual({
      athlete_id: "athlete_1",
      energy_kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      fiber_g: null,
      micronutrient_targets: null,
      meal_labels: null,
    });
  });
});
