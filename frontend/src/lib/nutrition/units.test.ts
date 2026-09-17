import { describe, expect, it } from "vitest";

import {
  MAX_QUANTITY_G,
  QUANTITY_UNITS,
  baseUnitLabel,
  basisFromUnit,
  defaultUnitForBasis,
  formatQuantity,
  toBaseQuantity,
  unitsForFood,
} from "./units";

describe("toBaseQuantity", () => {
  it("deja los gramos igual", () => {
    expect(toBaseQuantity(150, "g")).toBe(150);
  });

  it("convierte masa: onzas y libras al gramo", () => {
    expect(toBaseQuantity(1, "oz")).toBeCloseTo(28.3495, 3);
    expect(toBaseQuantity(2, "lb")).toBeCloseTo(907.1847, 3);
  });

  it("convierte volumen: litros, tazas y cucharadas al mililitro", () => {
    expect(toBaseQuantity(1.5, "l")).toBe(1500);
    expect(toBaseQuantity(1, "taza")).toBe(240);
    expect(toBaseQuantity(3, "cucharada")).toBe(45);
    expect(toBaseQuantity(2, "cucharadita")).toBe(10);
  });

  it("usa el tamano de porcion del alimento para `porcion`", () => {
    expect(toBaseQuantity(2, "porcion", 45)).toBe(90);
  });

  it("rechaza `porcion` cuando el alimento no declara tamano de porcion", () => {
    expect(toBaseQuantity(2, "porcion", null)).toBeNull();
    expect(toBaseQuantity(2, "porcion", 0)).toBeNull();
  });

  it("rechaza unidades desconocidas y cantidades no positivas", () => {
    expect(toBaseQuantity(10, "pizca")).toBeNull();
    expect(toBaseQuantity(0, "g")).toBeNull();
    expect(toBaseQuantity(-5, "g")).toBeNull();
  });

  it("rechaza lo que supera el tope, ya convertido", () => {
    // 6 kg = 6000 g, por encima del tope aunque el numero escrito sea chico.
    expect(toBaseQuantity(6, "kg")).toBeNull();
    expect(toBaseQuantity(5, "kg")).toBe(MAX_QUANTITY_G);
  });
});

describe("unitsForFood", () => {
  it("ofrece masa + cocina para un solido, sin volumen puro", () => {
    const keys = unitsForFood({ basis: "per_100g" }).map((unit) => unit.key);
    expect(keys).toContain("g");
    expect(keys).toContain("oz");
    expect(keys).toContain("taza");
    expect(keys).not.toContain("ml");
    expect(keys).not.toContain("l");
  });

  it("ofrece volumen + cocina para un liquido, sin masa", () => {
    const keys = unitsForFood({ basis: "per_100ml" }).map((unit) => unit.key);
    expect(keys).toContain("ml");
    expect(keys).toContain("l");
    expect(keys).toContain("cucharada");
    expect(keys).not.toContain("g");
    expect(keys).not.toContain("lb");
  });

  it("solo ofrece `porcion` si el alimento sabe cuanto pesa una", () => {
    expect(unitsForFood({ basis: "per_100g" }).map((u) => u.key)).not.toContain("porcion");
    expect(unitsForFood({ basis: "per_100g", servingSizeG: 30 }).map((u) => u.key)).toContain(
      "porcion",
    );
  });

  it("sin `basis` ofrece masa y volumen: no hay dato para descartar ninguna", () => {
    const keys = unitsForFood({}).map((unit) => unit.key);
    expect(keys).toContain("g");
    expect(keys).toContain("ml");
    expect(keys).toContain("lb");
    expect(keys).not.toContain("porcion");
  });
});

describe("defaultUnitForBasis", () => {
  it("cae en ml para liquidos y en g para todo lo demas", () => {
    expect(defaultUnitForBasis("per_100ml")).toBe("ml");
    expect(defaultUnitForBasis("per_100g")).toBe("g");
    expect(defaultUnitForBasis(null)).toBe("g");
  });
});

describe("basisFromUnit", () => {
  it("deduce la base cuando la unidad la delata", () => {
    expect(basisFromUnit("oz")).toBe("per_100g");
    expect(basisFromUnit("l")).toBe("per_100ml");
  });

  it("no inventa base con unidades de cocina ni con porciones", () => {
    expect(basisFromUnit("taza")).toBeNull();
    expect(basisFromUnit("porcion")).toBeNull();
    expect(basisFromUnit(null)).toBeNull();
  });
});

describe("baseUnitLabel", () => {
  it("manda el basis cuando se conoce", () => {
    expect(baseUnitLabel("per_100ml", "g")).toBe("ml");
    expect(baseUnitLabel("per_100g", "taza")).toBe("g");
  });

  it("sin basis se guia por la unidad elegida", () => {
    expect(baseUnitLabel(null, "taza")).toBe("ml");
    expect(baseUnitLabel(null, "lb")).toBe("g");
  });
});

describe("formatQuantity", () => {
  it("muestra la unidad en que se escribio", () => {
    expect(formatQuantity({ quantity_g: 240, quantity_value: 1, quantity_unit: "taza" })).toBe(
      "1 taza",
    );
    expect(formatQuantity({ quantity_g: 56.7, quantity_value: 2, quantity_unit: "oz" })).toBe("2 oz");
  });

  it("pluraliza porciones", () => {
    expect(formatQuantity({ quantity_g: 45, quantity_value: 1, quantity_unit: "porcion" })).toBe(
      "1 porcion",
    );
    expect(formatQuantity({ quantity_g: 90, quantity_value: 2, quantity_unit: "porcion" })).toBe(
      "2 porciones",
    );
  });

  it("cae a gramos en entradas viejas sin unidad", () => {
    expect(formatQuantity({ quantity_g: 120, quantity_value: null, quantity_unit: null })).toBe(
      "120 g",
    );
    expect(formatQuantity({ quantity_g: 120 })).toBe("120 g");
  });
});

describe("catalogo", () => {
  it("no tiene claves repetidas", () => {
    const keys = QUANTITY_UNITS.map((unit) => unit.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
