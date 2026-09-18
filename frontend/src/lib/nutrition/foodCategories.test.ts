import { describe, expect, it } from "vitest";

import {
  FOOD_CATEGORY_GROUPS,
  foodCategoryGroup,
  orphanCategories,
  visibleFoodCategoryGroups,
} from "./foodCategories";

const TCAC_2018 = [
  "Alimentos manufacturados",
  "Alimentos nativos",
  "Alimentos para regímenes especiales",
  "Alimentos preparados",
  "Bebidas (alcoholicas y no alcoholicas)",
  "Carnes y derivados",
  "Cereales y derivados",
  "Frutas y derivados",
  "Grasas y aceites",
  "Huevos y derivados",
  "Leche y derivados",
  "Leguminosas y derivados",
  "Misceláneos",
  "Pescados y mariscos",
  "Productos azucarados",
  "Verduras, hortalizas y derivados",
];

describe("foodCategories", () => {
  it("cubre todas las categorias del catalogo TCAC sembrado", () => {
    expect(orphanCategories(TCAC_2018)).toEqual([]);
  });

  it("no repite una categoria del catalogo en dos grupos", () => {
    const all = FOOD_CATEGORY_GROUPS.flatMap((group) => group.tcac);
    expect(all.length).toBe(new Set(all).size);
  });

  it("resuelve un grupo por su key", () => {
    expect(foodCategoryGroup("proteina")?.tcac).toContain("Carnes y derivados");
    expect(foodCategoryGroup("no-existe")).toBeNull();
    expect(foodCategoryGroup(null)).toBeNull();
  });

  it("oculta los grupos que el catalogo no puede llenar", () => {
    const groups = visibleFoodCategoryGroups(["Frutas y derivados", "Cereales y derivados"]);
    expect(groups.map((group) => group.key)).toEqual(["carbohidratos", "frutas"]);
  });

  it("muestra todos los grupos mientras el catalogo no ha cargado", () => {
    expect(visibleFoodCategoryGroups([])).toEqual(FOOD_CATEGORY_GROUPS);
  });

  it("manda las categorias sin grupo propio a 'Otros' en vez de esconderlas", () => {
    const groups = visibleFoodCategoryGroups(["Suplementos deportivos"]);
    expect(groups.map((group) => group.key)).toEqual(["otros"]);
    expect(groups[0].tcac).toContain("Suplementos deportivos");
  });
});
