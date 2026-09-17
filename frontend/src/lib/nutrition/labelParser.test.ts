import { describe, expect, it } from "vitest";
import { parseDecimalNumber, parseNutritionLabel } from "./labelParser";
import type { ParsedLabel, RequiredMacroKey } from "./types";

// ---------------------------------------------------------------------------
// Fixtures: etiquetas colombianas realistas, tal como saldrian de un OCR
// on-device (MLKit). Se escriben CON el ruido tipico: tildes perdidas,
// mayusculas inconsistentes, O/0 confundidos, espaciado irregular. No se
// "limpian" a mano porque entonces el test no prueba nada. Incluye la
// categoria liquida (leche, bebible, jugo) declarada por 100 ml, no por
// 100 g — bug real que corrigio esta version del parser.
// ---------------------------------------------------------------------------

type Fixture = {
  name: string;
  lines: string[];
  expected: Record<RequiredMacroKey, number>;
};

const FIXTURES: Fixture[] = [
  {
    // Doble columna + coma decimal + kJ/kcal juntos + O/0 en el encabezado ("1O0")
    name: "Alpina Yogurt Griego Fresa",
    lines: [
      "ALPINA YOGURT GRIEGO FRESA",
      "INFORMACION NUTRICIONAL",
      "Tamano de porcion 150 g",
      "Porciones por envase 1",
      "Por porcion   Por 1O0 g",
      "Energia   502 kJ/12O kcal   335 kJ/8O kcal",
      "Grasa total   3,5 g   2,3 g",
      "Grasa saturada   2,1 g   1,4 g",
      "Carbohidratos totales   12,5 g   8,3 g",
      "Azucares   1O,2 g   6,8 g",
      "Proteina   7,5 g   5,O g",
      "Sodio   65 mg   43 mg   3 %VD",
    ],
    expected: { energyKcal: 80, proteinG: 5, carbsTotalG: 8.3, fatTotalG: 2.3 },
  },
  {
    // Solo por porcion, energia SOLO en kJ (sin kcal en el texto)
    name: "Colombina Bon Bon Bum",
    lines: [
      "COLOMBINA BON BON BUM",
      "INFORMACION NUTRICIONAL",
      "Tamano de porcion 6 g (1 unidad)",
      "Porciones por envase 20",
      "Energia 100 kJ",
      "Grasa total 0,2 g 0 %VD",
      "Carbohidratos totales 5,8 g 2 %VD",
      "Azucares anadidos 4,9 g",
      "Proteina 0,1 g",
      "Sodio 5 mg 0 %VD",
    ],
    expected: { energyKcal: 23.9, proteinG: 0.1, carbsTotalG: 5.8, fatTotalG: 0.2 },
  },
  {
    // Porcion en ml (no gramos): no se puede normalizar a 100g, sirve para probar ese caso
    name: "Postobon Colombiana",
    lines: [
      "POSTOBON COLOMBIANA",
      "INFORMACION NUTRICIONAL",
      "Tamano de porcion 250 ml",
      "Porciones por envase 1,5",
      "Energia 460 kJ / 110 kcal",
      "Carbohidratos totales 27 g 9 %VD",
      "Azucares 27 g",
      "Sodio 30 mg 1 %VD",
      "Proteina 0 g",
      "Grasa total 0 g",
    ],
    expected: { energyKcal: 110, proteinG: 0, carbsTotalG: 27, fatTotalG: 0 },
  },
  {
    // Sodio con separador de miles ("1.2OO" -> 1200), colesterol, grasa saturada
    name: "Zenu Salchichon Cervecero",
    lines: [
      "ZENU SALCHICHON CERVECERO",
      "INFORMACION NUTRICIONAL",
      "Tamano de porcion 5O g",
      "Porciones por envase 6",
      "Energia 313 kcal",
      "Grasa total 14,5 g 22 %VD",
      "Grasa saturada 5,2 g 26 %VD",
      "Colesterol 45 mg 15 %VD",
      "Sodio 1.2OO mg 52 %VD",
      "Carbohidratos totales 3,1 g 1 %VD",
      "Proteina 13,8 g",
    ],
    expected: { energyKcal: 313, proteinG: 13.8, carbsTotalG: 3.1, fatTotalG: 14.5 },
  },
  {
    // Porcion declarada en unidades + gramos, mezcla de mayusculas/minusculas
    name: "Noel Saltinas",
    lines: [
      "NOEL SALTINAS",
      "informacion nutricional",
      "Tamano de porcion 30 g (6 galletas)",
      "Porciones por envase 12",
      "ENERGIA 130 KCAL",
      "grasa total 4,2 g 6 %VD",
      "grasa saturada 1,8 g 9 %VD",
      "Carbohidratos totales 21 g 7 %VD",
      "Fibra dietaria 0,9 g 4 %VD",
      "Azucares 1,5 g",
      "PROTEINA 2,6 G",
      "Sodio 210 mg 9 %VD",
    ],
    expected: { energyKcal: 130, proteinG: 2.6, carbsTotalG: 21, fatTotalG: 4.2 },
  },
  {
    // Ruido de OCR pesado en palabras (0 en vez de o) + grasas trans presente
    name: "Ramo Chocorramo",
    lines: [
      "RAMO CH0CORRAMO",
      "INF0RMACION NUTRICI0NAL",
      "Tamaño de porción 55 g",
      "P0rciones por envase 1",
      "Energia 220 kcal",
      "Grasa t0tal 11 g 17 %VD",
      "Grasa saturada 6 g 3O %VD",
      "Grasas trans 0,3 g",
      "Colesterol 15 mg 5 %VD",
      "Carb0hidrat0s totales 27 g 9 %VD",
      "Azucares anadidos 16 g",
      "Pr0teina 3 g",
      "Sodio 180 mg 8 %VD",
    ],
    expected: { energyKcal: 220, proteinG: 3, carbsTotalG: 27, fatTotalG: 11 },
  },
  {
    // Doble columna limpia, con fibra
    name: "Doria Spaguetti",
    lines: [
      "DORIA SPAGUETTI",
      "INFORMACION NUTRICIONAL",
      "Tamaño de porción 85 g",
      "Porciones por envase 4",
      "Por porción     Por 100 g",
      "Energía   298 kcal   350 kcal",
      "Grasa total   1,2 g   1,4 g",
      "Grasa saturada   0,3 g   0,4 g",
      "Carbohidratos totales   60 g   71 g",
      "Fibra dietaria   2,5 g   3 g",
      "Azúcares   2 g   2,4 g",
      "Proteína   10,5 g   12,4 g",
      "Sodio   4 mg   5 mg",
    ],
    expected: { energyKcal: 350, proteinG: 12.4, carbsTotalG: 71, fatTotalG: 1.4 },
  },
  {
    // kJ y kcal en la misma linea + micronutrientes al pie de la tabla
    name: "Nutresa Cereal Fitness",
    lines: [
      "NUTRESA CEREAL FITNESS",
      "INFORMACION NUTRICIONAL",
      "Tamaño de porción 30 g",
      "Porciones por envase 15",
      "Energía 1250 kJ / 299 kcal",
      "Grasa total 1 g 2 %VD",
      "Grasa saturada 0,3 g 2 %VD",
      "Carbohidratos totales 63 g 21 %VD",
      "Fibra dietaria 6 g 24 %VD",
      "Azúcares 18 g",
      "Azúcares añadidos 15 g",
      "Proteína 8 g",
      "Sodio 500 mg 22 %VD",
      "Vitamina C 12 mg 13 %VD",
      "Hierro 3,6 mg 20 %VD",
      "Calcio 120 mg 9 %VD",
      "Vitamina D 1 ug 5 %VD",
    ],
    expected: { energyKcal: 299, proteinG: 8, carbsTotalG: 63, fatTotalG: 1 },
  },
  {
    // Porcion en ml otra vez (lacteo), foco en calcio
    name: "Colanta Leche Entera UHT",
    lines: [
      "COLANTA LECHE ENTERA UHT",
      "INFORMACION NUTRICIONAL",
      "Tamaño de porción 200 ml",
      "Porciones por envase 5",
      "Energia 130 Kcal",
      "Grasa total 7 g 11 %VD",
      "Grasa saturada 4,5 g 23 %VD",
      "Carbohidratos totales 10 g 3 %VD",
      "Azucares 10 g",
      "Proteina 6,6 g",
      "Sodio 95 mg 4 %VD",
      "Calcio 240 mg 18 %VD",
    ],
    expected: { energyKcal: 130, proteinG: 6.6, carbsTotalG: 10, fatTotalG: 7 },
  },
  {
    name: "Bimbo Pan Tajado Integral",
    lines: [
      "BIMBO PAN TAJADO INTEGRAL",
      "INFORMACION NUTRICIONAL",
      "Tamaño de porción 40 g (2 tajadas)",
      "Porciones por envase 12",
      "Energía 100 kcal",
      "Grasa total 1,5 g 2 %VD",
      "Grasa saturada 0,4 g 2 %VD",
      "Carbohidratos totales 18 g 6 %VD",
      "Fibra dietaria 2,2 g 9 %VD",
      "Azúcares 1,8 g",
      "Proteína 4,3 g",
      "Sodio 190 mg 8 %VD",
    ],
    expected: { energyKcal: 100, proteinG: 4.3, carbsTotalG: 18, fatTotalG: 1.5 },
  },
  {
    // Estres: mayusculas + O/0 en ambas direcciones + lineas partidas (etiqueta y valor separados)
    name: "Colombina Wafer de Chocolate",
    lines: [
      "C0L0MBINA WAFER DE CH0C0LATE",
      "INFORMACI0N NUTRICI0NAL",
      "Tamano de porcion",
      "28 g (1 paquete)",
      "Porciones por envase 8",
      "ENERGIA",
      "142 KCAL",
      "GRASA T0TAL 7,8 G 12 %VD",
      "grasa saturada 4 g 2O %VD",
      "carb0hidrat0s t0tales 17 g 6 %VD",
      "azucares 9 g",
      "PR0TEINA",
      "1,6 G",
      "s0di0 55 mg 2 %VD",
    ],
    expected: { energyKcal: 142, proteinG: 1.6, carbsTotalG: 17, fatTotalG: 7.8 },
  },
  {
    // %VR en vez de %VD (tambien es ruido descartable)
    name: "Zenu Jamon de Pierna",
    lines: [
      "ZENU JAMON DE PIERNA",
      "INFORMACION NUTRICIONAL",
      "Tamaño de porción 45 g (2 tajadas)",
      "Porciones por envase 8",
      "Energía 55 kcal",
      "Grasa total 1,8 g 3 %VR",
      "Grasa saturada 0,6 g 3 %VR",
      "Grasas trans 0 g",
      "Colesterol 20 mg 7 %VR",
      "Sodio 380 mg 17 %VR",
      "Carbohidratos totales 1,5 g 1 %VR",
      "Proteína 9,4 g",
    ],
    expected: { energyKcal: 55, proteinG: 9.4, carbsTotalG: 1.5, fatTotalG: 1.8 },
  },
  {
    // LIQUIDO, doble columna en ML (no en g): la categoria liquida colombiana
    // completa (leche, yogur bebible, jugos, gaseosas) declara por 100 ml.
    name: "Alqueria Leche Deslactosada",
    lines: [
      "ALQUERIA LECHE DESLACTOSADA",
      "INFORMACION NUTRICIONAL",
      "Tamano de porcion 240 ml",
      "Porciones por envase 4",
      "Por porcion      Por 1OO ml",
      "Energia   220 kJ/53 kcal   92 kJ/22 kcal",
      "Grasa total   1,2 g   0,5 g",
      "Grasa saturada   0,7 g   0,3 g",
      "Carbohidratos totales   11,5 g   4,8 g",
      "Azucares   11,5 g   4,8 g",
      "Proteina   7,7 g   3,2 g",
      "Sodio   115 mg   48 mg   2 %VD",
    ],
    expected: { energyKcal: 22, proteinG: 3.2, carbsTotalG: 4.8, fatTotalG: 0.5 },
  },
  {
    // LIQUIDO, doble columna en ML, encabezado en mayusculas + minusculas mezcladas
    name: "Alpina Yogo Yogo Fresa (bebible)",
    lines: [
      "ALPINA YOGO YOGO FRESA",
      "informacion nutricional",
      "Tamano de porcion 200 ml",
      "Porciones por envase 1",
      "POR PORCION      POR 100 ML",
      "Energia   162 kcal   81 kcal",
      "Grasa total   3,8 g   1,9 g",
      "Grasa saturada   2,4 g   1,2 g",
      "Carbohidratos totales   25,4 g   12,7 g",
      "Azucares anadidos   18 g   9 g",
      "Proteina   5,8 g   2,9 g",
      "Sodio   80 mg   40 mg   3 %VD",
    ],
    expected: { energyKcal: 81, proteinG: 2.9, carbsTotalG: 12.7, fatTotalG: 1.9 },
  },
  {
    // LIQUIDO, columna SIMPLE en ml (formato tipico de un jugo en caja pequena):
    // no hay doble columna, asi que la base debe quedarse en per_serving y NO
    // debe confundirse con per_100ml solo porque la porcion esta en ml.
    name: "Postobon Hit Mango",
    lines: [
      "HIT MANGO",
      "INFORMACION NUTRICIONAL",
      "Tamano de porcion 200 ml",
      "Porciones por envase 1",
      "Energia 380 kJ / 91 kcal",
      "Carbohidratos totales 22,7 g 8 %VD",
      "Azucares 21 g",
      "Sodio 15 mg 1 %VD",
      "Proteina 0 g",
      "Grasa total 0 g",
    ],
    expected: { energyKcal: 91, proteinG: 0, carbsTotalG: 22.7, fatTotalG: 0 },
  },
];

const REQUIRED_FIELDS: RequiredMacroKey[] = ["energyKcal", "proteinG", "carbsTotalG", "fatTotalG"];

function isCloseEnough(actual: number | undefined, expected: number): boolean {
  if (actual === undefined) return false;
  return Math.abs(actual - expected) <= 0.2;
}

// ---------------------------------------------------------------------------
// Metrica de aceptacion: >=90% de extraccion correcta sobre los 4 campos
// obligatorios (kcal, proteina, carbohidratos, grasa), en todas las fixtures.
// ---------------------------------------------------------------------------

describe("parseNutritionLabel — metrica de aceptacion (>=90%)", () => {
  it("extrae correctamente al menos el 90% de los campos obligatorios", () => {
    let correct = 0;
    let total = 0;
    const failures: string[] = [];

    for (const fixture of FIXTURES) {
      const parsed = parseNutritionLabel(fixture.lines);
      for (const field of REQUIRED_FIELDS) {
        total++;
        const actual = parsed.macros[field]?.value;
        const expectedValue = fixture.expected[field];
        if (isCloseEnough(actual, expectedValue)) {
          correct++;
        } else {
          failures.push(`${fixture.name} / ${field}: esperado ${expectedValue}, obtenido ${actual ?? "undefined"}`);
        }
      }
    }

    const rate = correct / total;
     
    console.log(
      `\n[labelParser] tasa de extraccion sobre campos obligatorios: ${correct}/${total} = ${(rate * 100).toFixed(1)}%`,
    );
    if (failures.length > 0) {
       
      console.log(`[labelParser] fallos:\n  ${failures.join("\n  ")}`);
    }

    expect(rate).toBeGreaterThanOrEqual(0.9);
  });
});

// ---------------------------------------------------------------------------
// Casos individuales por fixture, para que un fallo puntual senale exactamente
// que etiqueta se rompio (la metrica agregada de arriba no lo deja ver sola).
// ---------------------------------------------------------------------------

describe("parseNutritionLabel — casos por etiqueta", () => {
  for (const fixture of FIXTURES) {
    it(`reconoce los 4 campos obligatorios en: ${fixture.name}`, () => {
      const parsed = parseNutritionLabel(fixture.lines);
      for (const field of REQUIRED_FIELDS) {
        expect(parsed.macros[field]?.value, `${fixture.name}: ${field}`).toBeCloseTo(fixture.expected[field], 0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Requisitos puntuales del doc (seccion 6.5), verificados de forma aislada
// ---------------------------------------------------------------------------

describe("parseDecimalNumber — coma decimal colombiana", () => {
  it("interpreta la coma como separador decimal", () => {
    expect(parseDecimalNumber("12,5")).toBe(12.5);
    expect(parseDecimalNumber("0,3")).toBe(0.3);
  });

  it("interpreta el punto como separador de miles cuando son grupos de 3 digitos", () => {
    expect(parseDecimalNumber("1.200")).toBe(1200);
    expect(parseDecimalNumber("2.500")).toBe(2500);
  });

  it("interpreta punto+coma como formato latino con miles", () => {
    expect(parseDecimalNumber("1.234,5")).toBe(1234.5);
  });

  it("no confunde un decimal de un solo grupo con miles", () => {
    expect(parseDecimalNumber("12.5")).toBe(12.5);
    expect(parseDecimalNumber("230")).toBe(230);
  });
});

describe("parseNutritionLabel — %VD/%VR es ruido, nunca un valor nutricional", () => {
  it('no confunde el "10" de "Sodio 230 mg 10 %VD" con el valor de sodio', () => {
    const parsed = parseNutritionLabel([
      "Informacion nutricional",
      "Tamaño de porción 30 g",
      "Sodio 230 mg 10 %VD",
      "Proteina 5 g",
      "Energia 100 kcal",
      "Grasa total 2 g",
      "Carbohidratos totales 15 g",
    ]);
    expect(parsed.macros.sodiumMg?.value).toBe(230);
  });
});

describe("parseNutritionLabel — energia: kJ y kcal juntos", () => {
  it("se queda con kcal cuando ambos aparecen en la misma linea", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 30 g",
      "Energía 1250 kJ / 299 kcal",
      "Proteina 5 g",
      "Grasa total 2 g",
      "Carbohidratos totales 15 g",
    ]);
    expect(parsed.macros.energyKcal?.value).toBe(299);
  });

  it("convierte kJ a kcal cuando no hay kcal en el texto (kcal = kJ / 4.184)", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 30 g",
      "Energía 418,4 kJ",
      "Proteina 5 g",
      "Grasa total 2 g",
      "Carbohidratos totales 15 g",
    ]);
    expect(parsed.macros.energyKcal?.value).toBeCloseTo(100, 1);
    expect(parsed.macros.energyKcal?.confidence).toBe("medium");
  });
});

describe("parseNutritionLabel — doble columna por porcion / por 100 g", () => {
  it("detecta la doble columna, expone base=per_100g y toma la segunda columna", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 50 g",
      "Por porción   Por 100 g",
      "Energía   150 kcal   300 kcal",
      "Proteina   4 g   8 g",
      "Grasa total   2 g   4 g",
      "Carbohidratos totales   10 g   20 g",
    ]);
    expect(parsed.base).toBe("per_100g");
    expect(parsed.baseConfidence).toBe("high");
    expect(parsed.macros.proteinG?.value).toBe(8);
    expect(parsed.macros.energyKcal?.value).toBe(300);
  });

  it("si falta una columna en una fila, usa el unico valor disponible con confianza baja y deja un warning", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 50 g",
      "Por porción   Por 100 g",
      "Energía   150 kcal   300 kcal",
      "Proteina   4 g",
      "Grasa total   2 g   4 g",
      "Carbohidratos totales   10 g   20 g",
    ]);
    expect(parsed.macros.proteinG?.value).toBe(4);
    expect(parsed.macros.proteinG?.confidence).toBe("low");
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
});

describe("parseNutritionLabel — doble columna por porcion / por 100 ml (liquidos)", () => {
  it("detecta la doble columna en ML (no en g), expone base=per_100ml y toma la segunda columna", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 200 ml",
      "Por porción   Por 100 ml",
      "Energía   180 kcal   90 kcal",
      "Proteina   6 g   3 g",
      "Grasa total   4 g   2 g",
      "Carbohidratos totales   20 g   10 g",
    ]);
    expect(parsed.base).toBe("per_100ml");
    expect(parsed.baseConfidence).toBe("high");
    expect(parsed.macros.proteinG?.value).toBe(3);
    expect(parsed.macros.energyKcal?.value).toBe(90);
  });

  it("tolera ruido OCR en el numero de la columna (1O0 ml / 10O ml) y espaciado irregular", () => {
    const conRuidoEnO = parseNutritionLabel([
      "Tamaño de porción 200 ml",
      "Por porcion       Por 1O0 ml",
      "Energia   180 kcal   90 kcal",
      "Proteina   6 g   3 g",
      "Grasa total   4 g   2 g",
      "Carbohidratos totales   20 g   10 g",
    ]);
    expect(conRuidoEnO.base).toBe("per_100ml");
    expect(conRuidoEnO.macros.proteinG?.value).toBe(3);

    const otraVariante = parseNutritionLabel([
      "Tamaño de porción 200 ml",
      "Por porcion Por 10O ml",
      "Energia   180 kcal   90 kcal",
      "Proteina   6 g   3 g",
      "Grasa total   4 g   2 g",
      "Carbohidratos totales   20 g   10 g",
    ]);
    expect(otraVariante.base).toBe("per_100ml");
    expect(otraVariante.macros.proteinG?.value).toBe(3);
  });

  it("no confunde la columna de 100 ml con la de 100 g: son bases distintas", () => {
    const enGramos = parseNutritionLabel([
      "Por porción   Por 100 g",
      "Proteina   6 g   3 g",
    ]);
    const enMililitros = parseNutritionLabel([
      "Por porción   Por 100 ml",
      "Proteina   6 g   3 g",
    ]);
    expect(enGramos.base).toBe("per_100g");
    expect(enMililitros.base).toBe("per_100ml");
  });
});

describe("parseNutritionLabel — columna simple con porcion en ml (sin doble columna)", () => {
  it("no confunde una porcion declarada en ml con base per_100ml: se queda en per_serving", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 200 ml",
      "Energía 91 kcal",
      "Proteina 0 g",
      "Grasa total 0 g",
      "Carbohidratos totales 22,7 g",
    ]);
    expect(parsed.base).toBe("per_serving");
    expect(parsed.macros.energyKcal?.value).toBe(91);
    // sin doble columna no hay como confirmar el valor de 100 ml: no se inventa
    expect(Object.keys(parsed.normalizedTo100)).toHaveLength(0);
  });
});

describe("parseNutritionLabel — tamano de porcion y normalizacion a 100 g", () => {
  it("extrae el tamano de porcion en gramos y normaliza a 100 g cuando la base es per_serving", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 50 g",
      "Energía 100 kcal",
      "Proteina 5 g",
      "Grasa total 2 g",
      "Carbohidratos totales 10 g",
    ]);
    expect(parsed.servingSizeG).toBe(50);
    expect(parsed.base).toBe("per_serving");
    // 50 g -> 100 g es factor x2
    expect(parsed.normalizedTo100.energyKcal?.value).toBe(200);
    expect(parsed.normalizedTo100.proteinG?.value).toBe(10);
    // la normalizacion es un calculo derivado: nunca puede quedar en "high"
    expect(parsed.normalizedTo100.proteinG?.confidence).not.toBe("high");
  });

  it("no normaliza y deja un warning cuando no hay tamano de porcion en gramos (ej. porciones en ml)", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 250 ml",
      "Energía 100 kcal",
      "Proteina 5 g",
      "Grasa total 2 g",
      "Carbohidratos totales 10 g",
    ]);
    expect(parsed.servingSizeG).toBeNull();
    expect(Object.keys(parsed.normalizedTo100)).toHaveLength(0);
    expect(parsed.warnings.some((w) => w.includes("normalizar"))).toBe(true);
  });
});

describe("parseNutritionLabel — micronutrientes al pie de la tabla", () => {
  it("reconoce micronutrientes comunes con su clave del registro canonico", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 30 g",
      "Energía 100 kcal",
      "Proteina 5 g",
      "Grasa total 2 g",
      "Carbohidratos totales 10 g",
      "Vitamina C 12 mg 13 %VD",
      "Hierro 3,6 mg 20 %VD",
      "Calcio 120 mg 9 %VD",
      "Vitamina B12 1,2 ug 50 %VD",
    ]);
    expect(parsed.micronutrients.vitamin_c_mg?.value).toBe(12);
    expect(parsed.micronutrients.iron_mg?.value).toBe(3.6);
    expect(parsed.micronutrients.calcium_mg?.value).toBe(120);
    expect(parsed.micronutrients.vitamin_b12_ug?.value).toBe(1.2);
  });
});

describe("parseNutritionLabel — lineas partidas por el OCR (etiqueta y valor separados)", () => {
  it("fusiona una linea de solo-etiqueta con la siguiente si esta empieza con un numero", () => {
    const parsed = parseNutritionLabel([
      "Tamaño de porción 30 g",
      "Proteina",
      "8,5 g",
      "Energia 100 kcal",
      "Grasa total 2 g",
      "Carbohidratos totales 10 g",
    ]);
    expect(parsed.macros.proteinG?.value).toBe(8.5);
  });
});

describe("parseNutritionLabel — funcion pura", () => {
  it("no muta el arreglo de lineas de entrada", () => {
    const lines = ["Tamaño de porción 30 g", "Energia 100 kcal", "Proteina 5 g"];
    const snapshot = [...lines];
    parseNutritionLabel(lines);
    expect(lines).toEqual(snapshot);
  });

  it("es deterministica: misma entrada, mismo resultado", () => {
    const lines = ["Tamaño de porción 30 g", "Energia 100 kcal", "Proteina 5 g", "Grasa total 2 g", "Carbohidratos totales 10 g"];
    const a = parseNutritionLabel(lines);
    const b = parseNutritionLabel(lines);
    expect(a).toEqual(b satisfies ParsedLabel);
  });

  it("no explota con un arreglo vacio", () => {
    const parsed = parseNutritionLabel([]);
    expect(parsed.macros).toEqual({});
    expect(parsed.base).toBe("per_serving");
    expect(parsed.baseConfidence).toBe("medium");
  });
});
