import { useEffect, useMemo, useState } from "react";

import { getDietFoodCategories, getRecentDietFoods, searchDietFoods, type FoodProduct } from "../../api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { foodCategoryGroup, visibleFoodCategoryGroups } from "../../lib/nutrition/foodCategories";

// Buscador de alimentos: termino, categoria elegida, recientes y resultados.
// Explorar sin escribir: arranca en los atajos (recientes + categorias) y solo
// cae a la lista de resultados cuando hay termino o categoria elegida. Ver
// `lib/nutrition/foodCategories.ts`.
export function useFoodSearch(athleteId: string | null | undefined, selectedFood: FoodProduct | null) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [recentFoods, setRecentFoods] = useState<FoodProduct[]>([]);

  const activeCategory = useMemo(() => foodCategoryGroup(categoryKey), [categoryKey]);

  // Las categorias del catálogo se piden una vez: solo sirven para no ofrecer
  // grupos que abririan vacios.
  useEffect(() => {
    getDietFoodCategories()
      .then(setCatalogCategories)
      .catch(() => setCatalogCategories([]));
  }, []);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    getRecentDietFoods(athleteId, 8)
      .then((rows) => {
        if (!cancelled) setRecentFoods(rows);
      })
      .catch(() => {
        if (!cancelled) setRecentFoods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  // Con categoria elegida el termino vacio es válido: lista el grupo entero
  // (el backend admite `q=""`), y escribir filtra dentro de ese grupo.
  const term = query.trim();
  const debouncedTerm = useDebouncedValue(term, 300);
  // Un termino vacio busca sin demora; con texto espera a que `debouncedTerm` lo alcance.
  const termSettled = term === "" || term === debouncedTerm;

  useEffect(() => {
    if (selectedFood || (!term && !activeCategory)) {
      setResults([]);
      return;
    }
    if (!termSettled) return;
    let cancelled = false;
    setSearching(true);
    searchDietFoods({
      q: term,
      scope: "all",
      category: activeCategory ? activeCategory.tcac : undefined,
      limit: activeCategory ? 60 : undefined,
    })
      .then((rows) => {
        if (!cancelled) setResults(rows);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, termSettled, selectedFood, activeCategory]);

  const categoryGroups = useMemo(
    () => visibleFoodCategoryGroups(catalogCategories),
    [catalogCategories],
  );

  return {
    query,
    setQuery,
    results,
    setResults,
    searching,
    categoryKey,
    setCategoryKey,
    activeCategory,
    recentFoods,
    categoryGroups,
  };
}
