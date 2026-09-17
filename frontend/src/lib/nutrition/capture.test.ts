import { describe, expect, it } from "vitest";

import {
  buildLabelPrefill,
  classifyBarcodeLookup,
  decideFoodOwnership,
  nextCaptureStep,
  PHOTO_FORM_MACRO_KEYS,
} from "./capture";
import { parseNutritionLabel } from "./labelParser";
import type { ParsedLabel } from "./types";

// ---------------------------------------------------------------------------
// Barcode -> busqueda
// ---------------------------------------------------------------------------

describe("classifyBarcodeLookup / nextCaptureStep", () => {
  it("producto encontrado -> confirmar cantidad", () => {
    const outcome = classifyBarcodeLookup({ ok: true });
    expect(outcome).toEqual({ kind: "found" });
    expect(nextCaptureStep(outcome)).toBe("confirm-quantity");
  });

  it("404 (no existe ni local ni en OFF) -> registro por foto", () => {
    const outcome = classifyBarcodeLookup({ ok: false, status: 404, message: "Product not found." });
    expect(outcome).toEqual({ kind: "not-found" });
    expect(nextCaptureStep(outcome)).toBe("photo-capture");
  });

  it("un error real (500, red caida) NO se confunde con 'no existe'", () => {
    const outcome = classifyBarcodeLookup({ ok: false, status: 500, message: "Internal error" });
    expect(outcome).toEqual({ kind: "error", message: "Internal error" });
    expect(nextCaptureStep(outcome)).toBe("scan-error");
  });

  it("401/403 tambien es un error, no 'no existe'", () => {
    const outcome = classifyBarcodeLookup({ ok: false, status: 401, message: "Unauthorized" });
    expect(nextCaptureStep(outcome)).toBe("scan-error");
  });

  it("mensaje vacio cae a un texto por defecto", () => {
    const outcome = classifyBarcodeLookup({ ok: false, status: 502, message: "" });
    expect(outcome).toEqual({ kind: "error", message: "No se pudo buscar el código de barras." });
  });
});

// ---------------------------------------------------------------------------
// Catalogo compartido vs personal
// ---------------------------------------------------------------------------

describe("decideFoodOwnership", () => {
  it("con barcode -> aporta al catalogo compartido (pending, visible para todos)", () => {
    const decision = decideFoodOwnership("7702001234567");
    expect(decision.contributesToSharedCatalog).toBe(true);
    expect(decision.noteEs).toMatch(/catálogo compartido/);
  });

  it("sin barcode -> alimento personal", () => {
    expect(decideFoodOwnership(null).contributesToSharedCatalog).toBe(false);
    expect(decideFoodOwnership(undefined).contributesToSharedCatalog).toBe(false);
    expect(decideFoodOwnership("").contributesToSharedCatalog).toBe(false);
  });

  it("un barcode de solo espacios cuenta como ausente", () => {
    expect(decideFoodOwnership("   ").contributesToSharedCatalog).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prellenado desde el parser de etiquetas
// ---------------------------------------------------------------------------

describe("buildLabelPrefill", () => {
  it("doble columna por 100 g: prellena directo desde normalizedTo100, basis per_100g", () => {
    const label = parseNutritionLabel([
      "Tamano de porcion 30 g",
      "Por porcion   Por 100 g",
      "Energia   150 kcal   500 kcal",
      "Proteina   3 g   10 g",
      "Carbohidratos totales   20 g   66,7 g",
      "Grasa total   5 g   16,7 g",
    ]);

    const prefill = buildLabelPrefill(label);
    expect(prefill.basis).toBe("per_100g");
    expect(prefill.needsServingSize).toBe(false);
    expect(prefill.values.energy_kcal?.value).toBe(500);
    expect(prefill.values.protein_g?.value).toBe(10);
    expect(prefill.values.carbs_g?.value).toBeCloseTo(66.7);
    expect(prefill.values.fat_g?.value).toBeCloseTo(16.7);
  });

  it("categoria liquida (doble columna por 100 ml): basis per_100ml, no per_100g", () => {
    const label = parseNutritionLabel([
      "Tamano de porcion 200 ml",
      "Por porcion   Por 100 ml",
      "Energia   90 kcal   45 kcal",
      "Proteina   6 g   3 g",
    ]);

    const prefill = buildLabelPrefill(label);
    expect(prefill.basis).toBe("per_100ml");
    expect(prefill.needsServingSize).toBe(false);
    expect(prefill.values.energy_kcal?.value).toBe(45);
  });

  it("columna simple con tamano de porcion en gramos: SI normaliza y prellena", () => {
    const label = parseNutritionLabel([
      "Tamano de porcion 50 g",
      "Energia 200 kcal",
      "Proteina 10 g",
    ]);

    expect(label.base).toBe("per_serving");
    const prefill = buildLabelPrefill(label);
    expect(prefill.needsServingSize).toBe(false);
    // 200 kcal / 50 g * 100 = 400 kcal por 100 g
    expect(prefill.values.energy_kcal?.value).toBe(400);
  });

  it("columna simple SIN tamano de porcion conocido: no inventa nada, pide el dato", () => {
    // Sin encabezado de "Tamano de porcion" en gramos, sin doble columna:
    // el parser no puede normalizar. El prellenado debe quedar vacio.
    const label = parseNutritionLabel(["Energia 90 kcal", "Proteina 2 g"]);

    expect(label.base).toBe("per_serving");
    expect(label.servingSizeG).toBeNull();
    const prefill = buildLabelPrefill(label);
    expect(prefill.needsServingSize).toBe(true);
    expect(prefill.values).toEqual({});
  });

  it("porcion declarada en ml (no gramos), columna simple: tampoco inventa la normalizacion", () => {
    const label = parseNutritionLabel(["Tamano de porcion 1 taza (240 ml)", "Energia 120 kcal"]);
    expect(label.servingSizeG).toBeNull();
    const prefill = buildLabelPrefill(label);
    expect(prefill.needsServingSize).toBe(true);
    expect(prefill.values).toEqual({});
  });

  it("base null (defensivo, aunque el parser actual no lo produce): tampoco inventa nada", () => {
    const label: ParsedLabel = {
      base: null,
      baseConfidence: "low",
      servingSizeG: null,
      servingSizeRaw: null,
      servingsPerContainer: null,
      macros: { energyKcal: { value: 100, confidence: "low" } },
      micronutrients: {},
      normalizedTo100: {},
      warnings: [],
    };
    const prefill = buildLabelPrefill(label);
    expect(prefill.needsServingSize).toBe(true);
    expect(prefill.values).toEqual({});
    expect(prefill.basis).toBe("per_100g");
  });

  it("todas las claves del formulario son un subconjunto valido de las que produce el prellenado", () => {
    const label = parseNutritionLabel([
      "Tamano de porcion 100 g",
      "Energia 100 kcal",
      "Proteina 1 g",
      "Carbohidratos totales 2 g",
      "Azucares 1 g",
      "Fibra 1 g",
      "Grasa total 3 g",
      "Grasa saturada 1 g",
      "Sodio 50 mg",
    ]);
    const prefill = buildLabelPrefill(label);
    for (const key of Object.keys(prefill.values)) {
      expect(PHOTO_FORM_MACRO_KEYS).toContain(key);
    }
  });
});
