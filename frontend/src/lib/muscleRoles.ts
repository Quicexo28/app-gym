import { BODY_SLUGS, BODY_SLUG_LABELS, toBodySlug, type BodySlug } from "./bodyMap";

/** Papel de un musculo extra en un ejercicio: secundario pesa 0.5, principal (segundo principal) pesa 1. */
export type MuscleRole = "secondary" | "main";
export type MuscleRoles = Partial<Record<BodySlug, MuscleRole>>;
export type ExtraMuscle = { group: string; weight: number };

export const SECONDARY_WEIGHT = 0.5;
export const MAIN_WEIGHT = 1;
/** Limite del servidor (`max_length=6` en exercises_catalog.py). */
export const MAX_EXTRA_MUSCLES = 6;

/** Papeles editables desde los musculos extra guardados. Peso >= 1 = principal; el resto = secundario. */
export function rolesFromExtras(extras: ExtraMuscle[] | undefined): MuscleRoles {
  const roles: MuscleRoles = {};
  for (const extra of extras || []) {
    const slug = toBodySlug(extra.group);
    if (!slug || !(extra.weight > 0)) continue;
    const role: MuscleRole = extra.weight >= MAIN_WEIGHT ? "main" : "secondary";
    if (roles[slug] !== "main") roles[slug] = role;
  }
  return roles;
}

/**
 * Musculos extra a guardar. El grupo del ejercicio (principal) no se repite.
 * Los extras guardados que no mapean a un grupo del mapa corporal se conservan sin cambios.
 */
export function extrasFromRoles(roles: MuscleRoles, primaryGroup: string, original: ExtraMuscle[] = []): ExtraMuscle[] {
  const primary = toBodySlug(primaryGroup);
  const preserved = original.filter((extra) => !toBodySlug(extra.group));
  const edited = BODY_SLUGS.filter((slug) => slug !== primary && roles[slug]).map((slug) => ({
    group: BODY_SLUG_LABELS[slug],
    weight: roles[slug] === "main" ? MAIN_WEIGHT : SECONDARY_WEIGHT,
  }));
  return [...edited, ...preserved];
}
