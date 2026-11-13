/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BODY_SLUGS } from "./bodyMap";
import { PIECE_SLUGS, pieceSlugs } from "./bodyModel";

/** Nombres de nodo del GLB (lee solo el bloque JSON de cabecera). */
function glbNodeNames(path: string): string[] {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as { nodes: Array<{ name?: string; mesh?: number }> };
  return json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name ?? "");
}

describe("modelo 3D del cuerpo", () => {
  const names = glbNodeNames(new URL("../../public/body/maniqui.glb", import.meta.url).pathname);

  it("el GLB trae las 36 piezas con nombre, sin repetir", () => {
    expect(names).toHaveLength(36);
    expect(new Set(names).size).toBe(36);
    expect(names.every((n) => n.length > 0)).toBe(true);
  });

  it("cada pieza mapeada existe en el GLB (sin nombres huerfanos)", () => {
    for (const piece of Object.keys(PIECE_SLUGS)) expect(names).toContain(piece);
  });

  it("todo grupo del mapa marca al menos una pieza", () => {
    const covered = new Set(Object.values(PIECE_SLUGS).flat());
    expect(BODY_SLUGS.filter((s) => !covered.has(s))).toEqual([]);
  });

  it("las piezas neutras no marcan ningun grupo", () => {
    for (const piece of ["cabeza", "cuello", "mano_der", "antebrazo_izq", "pie_der", "pelvis", "interno_cadera_izq"]) {
      expect(names).toContain(piece);
      expect(pieceSlugs(piece)).toEqual([]);
    }
  });

  it("la espalda se reparte en cuatro grupos propios", () => {
    expect(pieceSlugs("dorsal_der")).toEqual(["dorsal"]);
    expect(pieceSlugs("dorsal_izq")).toEqual(["dorsal"]);
    expect(pieceSlugs("trapecio_superior")).toEqual(["trapecio"]);
    expect(pieceSlugs("trapecio_medio")).toEqual(["espalda"]);
    expect(pieceSlugs("lumbar")).toEqual(["lumbar"]);
  });

  it("abductor marca la pieza del gluteo", () => {
    expect(pieceSlugs("gluteo_der")).toContain("abductor");
    expect(pieceSlugs("gluteo_izq")).toContain("abductor");
  });
});
