/**
 * Grupos del buscador de alimentos.
 *
 * El catálogo viene con las categorias del TCAC 2018 (ICBF), que estan pensadas
 * para una tabla de composición, no para alguien que registra lo que comio:
 * "Cereales y derivados", "Leguminosas y derivados", "Misceláneos". Aquí se
 * reagrupan en las etiquetas con las que la gente piensa la comida (proteína,
 * carbohidratos, vegetales) y cada grupo apunta a una o varias categorias TCAC,
 * que es lo que viaja al backend en `?category=` (repetible).
 *
 * `tcac` debe coincidir EXACTO con `food_products.category`, porque el filtro es
 * una igualdad en SQL. Si el catálogo suma categorias nuevas, `orphanCategories`
 * las detecta para que no queden invisibles.
 */

export type FoodCategoryGroup = {
  key: string;
  label: string;
  emoji: string;
  tcac: string[];
};

export const FOOD_CATEGORY_GROUPS: FoodCategoryGroup[] = [
  {
    key: "proteina",
    label: "Proteína",
    emoji: "🥩",
    tcac: ["Carnes y derivados", "Pescados y mariscos", "Huevos y derivados"],
  },
  { key: "carbohidratos", label: "Carbohidratos", emoji: "🌾", tcac: ["Cereales y derivados"] },
  { key: "vegetales", label: "Vegetales", emoji: "🥬", tcac: ["Verduras, hortalizas y derivados"] },
  { key: "frutas", label: "Frutas", emoji: "🍎", tcac: ["Frutas y derivados"] },
  { key: "lacteos", label: "Lacteos", emoji: "🥛", tcac: ["Leche y derivados"] },
  { key: "legumbres", label: "Legumbres", emoji: "🫘", tcac: ["Leguminosas y derivados"] },
  { key: "grasas", label: "Grasas y aceites", emoji: "🫒", tcac: ["Grasas y aceites"] },
  { key: "bebidas", label: "Bebidas", emoji: "🥤", tcac: ["Bebidas (alcoholicas y no alcoholicas)"] },
  { key: "dulces", label: "Dulces", emoji: "🍬", tcac: ["Productos azucarados"] },
  {
    key: "preparados",
    label: "Preparados",
    emoji: "🍲",
    tcac: ["Alimentos preparados", "Alimentos manufacturados", "Alimentos para regímenes especiales"],
  },
  { key: "nativos", label: "Nativos", emoji: "🌿", tcac: ["Alimentos nativos"] },
  { key: "otros", label: "Otros", emoji: "🧂", tcac: ["Misceláneos"] },
];

const BY_KEY = new Map(FOOD_CATEGORY_GROUPS.map((group) => [group.key, group]));

export function foodCategoryGroup(key: string | null): FoodCategoryGroup | null {
  if (!key) return null;
  return BY_KEY.get(key) || null;
}

const OTHERS_KEY = "otros";

/** Categorias del catálogo que ningun grupo reclama (senal de catálogo nuevo). */
export function orphanCategories(available: string[]): string[] {
  const claimed = new Set(FOOD_CATEGORY_GROUPS.flatMap((group) => group.tcac));
  return available.filter((name) => !claimed.has(name));
}

/**
 * Grupos que el catálogo del atleta realmente puede llenar.
 *
 * `available` son las categorias que devuelve `GET /diet/foods/categories` para
 * su scope: sin esto el buscador ofreceria pestanas que abren en vacio. Con la
 * lista aún sin cargar (vacia) se devuelven todos los grupos, para no parpadear.
 *
 * Las categorias que no reclama ningun grupo caen en "Otros" en vez de
 * desaparecer: si el catálogo crece, lo nuevo sigue siendo alcanzable sin tocar
 * este archivo.
 */
export function visibleFoodCategoryGroups(available: string[]): FoodCategoryGroup[] {
  if (available.length === 0) return FOOD_CATEGORY_GROUPS;
  const present = new Set(available);
  const orphans = orphanCategories(available);
  const resolved: FoodCategoryGroup[] = [];
  for (const group of FOOD_CATEGORY_GROUPS) {
    const tcac = group.key === OTHERS_KEY ? [...group.tcac, ...orphans] : group.tcac;
    if (tcac.some((name) => present.has(name))) resolved.push({ ...group, tcac });
  }
  return resolved;
}
