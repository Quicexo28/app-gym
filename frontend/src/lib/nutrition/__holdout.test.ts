import { describe, expect, it } from "vitest";
import { parseNutritionLabel } from "./labelParser";
import type { RequiredMacroKey } from "./types";

// Fixtures HOLDOUT: escritos por el orquestador, el agente del parser nunca los vio.
const HOLDOUT = [
  {
    name: "Colanta Leche Deslactosada (doble columna, tildes rotas)",
    lines: [
      "COLANTA LECHE DESLACTOSADA",
      "Informacion Nutricional",
      "Tamano de porcion 200 ml",
      "Porciones por envase 5",
      "                 Por porcion    Por 100 ml",
      "Energia          380 kJ/91 kcal  190 kJ/46 kcal",
      "Grasa total      3,0 g           1,5 g   5 %VD",
      "Grasa saturada   1,9 g           1,0 g",
      "Carbohidratos totales 9,6 g      4,8 g   2 %VD",
      "Azucares         9,6 g           4,8 g",
      "Proteina         6,4 g           3,2 g",
      "Sodio            96 mg           48 mg   2 %VD",
    ],
    expected: { energyKcal: 46, proteinG: 3.2, carbsTotalG: 4.8, fatTotalG: 1.5 },
  },
  {
    name: "Doria Pasta Espagueti (solo porcion, ruido O/0)",
    lines: [
      "D0RIA ESPAGUETI",
      "INF0RMACI0N NUTRICI0NAL",
      "Tamaño de porción 80 g",
      "P0rciones p0r envase 6",
      "Energia 283 kcal",
      "Grasa t0tal 1,1 g 2 %VD",
      "Grasa saturada 0,2 g 1 %VD",
      "Carb0hidratos totales 58,4 g 19 %VD",
      "Fibra dietaria 2,4 g 1O %VD",
      "Pr0teina 1O,2 g",
      "S0dio 4 mg 0 %VD",
    ],
    expected: { energyKcal: 283, proteinG: 10.2, carbsTotalG: 58.4, fatTotalG: 1.1 },
  },
  {
    name: "Bimbo Pan Integral (kJ solamente, azucares anadidos)",
    lines: [
      "BIMBO PAN INTEGRAL",
      "INFORMACION NUTRICIONAL",
      "Tamano de porcion 60 g (2 tajadas)",
      "Porciones por envase 10",
      "Energia 1046 kJ",
      "Grasa total 2,8 g",
      "Grasa saturada 0,6 g",
      "Grasas trans 0 g",
      "Carbohidratos totales 44,2 g",
      "Fibra dietaria 5,1 g",
      "Azucares 4,3 g",
      "Azucares anadidos 3,0 g",
      "Proteina 9,4 g",
      "Sodio 420 mg 18 %VD",
    ],
    expected: { energyKcal: 250.0, proteinG: 9.4, carbsTotalG: 44.2, fatTotalG: 2.8 },
  },
];

const FIELDS: readonly RequiredMacroKey[] = ["energyKcal", "proteinG", "carbsTotalG", "fatTotalG"];

describe("HOLDOUT — generalizacion del parser", () => {
  it("reporta tasa sobre fixtures nunca vistos", () => {
    let correct = 0, total = 0;
    const fails: string[] = [];
    for (const f of HOLDOUT) {
      const parsed = parseNutritionLabel(f.lines);
      for (const field of FIELDS) {
        total++;
        const actual = parsed.macros[field]?.value;
        const exp = f.expected[field];
        if (actual !== undefined && Math.abs(actual - exp) <= Math.max(0.2, exp * 0.02)) correct++;
        else fails.push(`${f.name} / ${field}: esperado ${exp}, obtenido ${actual ?? "undefined"}`);
      }
    }
    console.log(`\n[HOLDOUT] ${correct}/${total} = ${((correct/total)*100).toFixed(1)}%`);
    if (fails.length) console.log("FALLOS:\n  " + fails.join("\n  "));
    expect(total).toBe(12);
  });
});
