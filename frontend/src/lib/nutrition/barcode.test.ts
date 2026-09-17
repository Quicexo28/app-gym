import { describe, expect, it } from "vitest";

import { detectBarcodeCapability, scanBarcode } from "./barcode";

describe("detectBarcodeCapability", () => {
  it("prefiere nativo (ML Kit) cuando corre dentro de Capacitor, sin importar el navegador", () => {
    expect(detectBarcodeCapability({ isNative: true, hasBarcodeDetector: true })).toBe("native");
    expect(detectBarcodeCapability({ isNative: true, hasBarcodeDetector: false })).toBe("native");
  });

  it("usa BarcodeDetector del navegador en web cuando esta soportado", () => {
    expect(detectBarcodeCapability({ isNative: false, hasBarcodeDetector: true })).toBe("web-detector");
  });

  it("cae a entrada manual cuando no hay nativo ni BarcodeDetector", () => {
    expect(detectBarcodeCapability({ isNative: false, hasBarcodeDetector: false })).toBe("manual");
  });
});

describe("scanBarcode — despacho por capacidad", () => {
  it("capacidad 'manual' nunca abre camara: resuelve unavailable de inmediato", async () => {
    const result = await scanBarcode("manual");
    expect(result).toEqual({
      status: "unavailable",
      message: "Este dispositivo no soporta escaneo automático. Ingresa el código manualmente.",
    });
  });

  it("capacidad 'web-detector' sin <video> no intenta acceder a la camara", async () => {
    const result = await scanBarcode("web-detector");
    expect(result).toEqual({ status: "unavailable", message: "Falta el elemento de video para escanear." });
  });
});
