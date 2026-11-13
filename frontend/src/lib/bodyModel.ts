import type { BodySlug } from "./bodyMap";

/** Modelo 3D del cuerpo: una malla por pieza muscular, con material solido (sin texturas). */
export const BODY_MODEL_URL = "/body/maniqui.glb";

/**
 * Nombre de pieza del GLB -> grupos del mapa corporal que la marcan (gana el de mayor valor).
 * Las piezas que no estan aqui (cabeza, cuello, manos, antebrazos, pies, pelvis, internas) se dibujan en el color neutro.
 * "espalda" (Espalda Alta) usa la pieza trapecio_medio. El modelo no trae pieza propia para "abductor":
 * ese grupo marca la pieza del gluteo, donde esta el gluteo medio.
 */
export const PIECE_SLUGS: Readonly<Record<string, readonly BodySlug[]>> = {
  hombro_der: ["hombro"], hombro_izq: ["hombro"], interno_hombro_der: ["hombro"], interno_hombro_izq: ["hombro"],
  biceps_der: ["bicep"], biceps_izq: ["bicep"],
  tricep_der: ["tricep"], tricep_izq: ["tricep"],
  pecho: ["pecho"],
  dorsal_der: ["dorsal"], dorsal_izq: ["dorsal"],
  trapecio_medio: ["espalda"],
  trapecio_superior: ["trapecio"],
  lumbar: ["lumbar"],
  abdomen: ["abdomen"],
  gluteo_der: ["gluteo", "abductor"], gluteo_izq: ["gluteo", "abductor"],
  aductor_der: ["aductor"], aductor_izq: ["aductor"],
  cuadriceps_der: ["cuadricep"], cuadriceps_izq: ["cuadricep"],
  femoral_der: ["femoral"], femoral_izq: ["femoral"],
  pantorrilla_der: ["pantorrilla"], pantorrilla_izq: ["pantorrilla"],
};

/** Grupos del mapa que marcan una pieza del GLB; vacio si es parte neutra. */
export function pieceSlugs(pieceName: string): readonly BodySlug[] {
  return PIECE_SLUGS[pieceName] ?? [];
}
