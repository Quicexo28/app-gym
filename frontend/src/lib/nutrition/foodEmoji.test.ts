import { describe, expect, it } from "vitest";

import { DEFAULT_FOOD_EMOJI, foodEmoji } from "./foodEmoji";

describe("foodEmoji", () => {
  it("resuelve por nombre sin importar tildes ni mayusculas", () => {
    expect(foodEmoji("Arepa de maíz precocido")).toBe("🫓");
    expect(foodEmoji("PLÁTANO maduro")).toBe("🍌");
    expect(foodEmoji("piña, cruda")).toBe("🍍");
  });

  it("exige palabra completa: 'pan' no matchea 'panela' ni 'papa' matchea 'papaya'", () => {
    expect(foodEmoji("Pan tajado integral")).toBe("🍞");
    expect(foodEmoji("Panela, en bloque")).toBe("🍬");
    expect(foodEmoji("Papa cocida")).toBe("🥔");
    expect(foodEmoji("Papaya, madura, cruda")).toBe("🍈");
  });

  it("lo especifico gana a lo generico", () => {
    expect(foodEmoji("Huevo de gallina, entero, crudo")).toBe("🥚");
    expect(foodEmoji("Leche de cabra, entera")).toBe("🥛");
    expect(foodEmoji("Arroz con leche")).toBe("🍮");
    expect(foodEmoji("Mantequilla de mani")).toBe("🥜");
    expect(foodEmoji("Mantequilla")).toBe("🧈");
  });

  it("ignora las notas de preparacion del catalogo TCAC", () => {
    // "sin sal" no debe arrastrar el match a 🧂 ni "con azucar" a 🍬.
    expect(foodEmoji("Chontaduro, cocido, sin sal", "Frutas y derivados")).toBe("🍎");
    expect(foodEmoji("Sal yodada")).toBe("🧂");
  });

  it("cae a la categoria cuando el nombre no dice nada util", () => {
    expect(foodEmoji("Bore, hoja, cruda", "Verduras, hortalizas y derivados")).toBe("🥬");
    expect(foodEmoji("(sin nombre OCR, D012)", "Grasas y aceites")).toBe("🫒");
    expect(foodEmoji("Cubio, crudo", "Alimentos nativos")).toBe("🍠");
  });

  it("devuelve el default cuando no hay nombre ni categoria util", () => {
    expect(foodEmoji("")).toBe(DEFAULT_FOOD_EMOJI);
    expect(foodEmoji("XYZ123", null)).toBe(DEFAULT_FOOD_EMOJI);
    expect(foodEmoji("XYZ123", "Categoria inventada")).toBe(DEFAULT_FOOD_EMOJI);
  });
});
