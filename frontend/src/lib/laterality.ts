// Lateralidad: el catálogo solo lista ejercicios bilaterales. "Unilateral" es una propiedad que se
// activa al agregar el ejercicio y se guarda como sufijo del nombre (los datos guardados son texto).
// Se mantiene el formato histórico: "... - Unilateral" si no hay subvariante; "<subvariante> Unilateral" si la hay.
const UNILATERAL_SUFFIX = /(?:\s-\s|\s)Unilateral$/i;

export type SetSides = { left: boolean; right: boolean };

export function isUnilateralName(name: string): boolean {
  return UNILATERAL_SUFFIX.test(name.trim());
}

/** Nombre del ejercicio bilateral equivalente (el que existe en el catálogo). */
export function baseExerciseName(name: string): string {
  return name.trim().replace(UNILATERAL_SUFFIX, "");
}

export function withUnilateralName(name: string, hasSubvariation: boolean): string {
  const base = baseExerciseName(name);
  return hasSubvariation ? `${base} Unilateral` : `${base} - Unilateral`;
}

/** Activa o quita "Unilateral" en un nombre guardado. Con 3 o más niveles hay subvariante. */
export function setUnilateralName(name: string, unilateral: boolean): string {
  const base = baseExerciseName(name);
  if (!unilateral) return base;
  return withUnilateralName(base, base.split(" - ").length >= 3);
}

/** Copia de la entrada del catálogo con el nombre unilateral. Mismo grupo y músculos. */
export function asUnilateralEntry<T extends { name: string; subvariation: string }>(entry: T): T {
  return { ...entry, name: withUnilateralName(entry.name, Boolean(entry.subvariation)) };
}

/** Lados marcados de una serie. Sin dato por lado, ambos siguen a `completed` (sesiones viejas). */
export function setSides(set: { completed: boolean; sides?: SetSides }): SetSides {
  return set.sides ?? { left: set.completed, right: set.completed };
}
