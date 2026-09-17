/**
 * Escaneo de código de barras (doc `modulo-dieta.md` #6.5), en orden de
 * preferencia:
 *
 *  1. `@capacitor-mlkit/barcode-scanning` en nativo (Android/iOS).
 *  2. `BarcodeDetector` del navegador en web, si esta soportado.
 *  3. Entrada manual como último recurso.
 *
 * Nunca se asume que una API existe: `detectBarcodeCapability` es la única
 * fuente de verdad y siempre se consulta antes de intentar escanear. El
 * plugin de ML Kit se importa de forma perezosa (`import()` dinamico) para
 * que no entre al bundle web — ver nota de tamano en el doc #6.5.
 */

import { Capacitor } from "@capacitor/core";

export type BarcodeCapability = "native" | "web-detector" | "manual";

export type BarcodeScanResult =
  | { status: "found"; barcode: string }
  | { status: "cancelled" }
  | { status: "permission-denied"; message: string }
  | { status: "unavailable"; message: string };

const CAMERA_PERMISSION_DENIED_MESSAGE =
  "Alzo necesita permiso de camara para escanear el código de barras. Actívalo en Ajustes > Aplicaciones > Alzo > Permisos.";

// ---------------------------------------------------------------------------
// Deteccion de capacidad — pura, testable sin DOM ni plugins reales.
// ---------------------------------------------------------------------------

export type BarcodeCapabilityEnv = { isNative: boolean; hasBarcodeDetector: boolean };

export function detectBarcodeCapability(env: BarcodeCapabilityEnv): BarcodeCapability {
  if (env.isNative) return "native";
  if (env.hasBarcodeDetector) return "web-detector";
  return "manual";
}

function hasGlobalBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** Versión impura de `detectBarcodeCapability`: lee el entorno real. */
export function currentBarcodeCapability(): BarcodeCapability {
  return detectBarcodeCapability({
    isNative: Capacitor.isNativePlatform(),
    hasBarcodeDetector: hasGlobalBarcodeDetector(),
  });
}

// ---------------------------------------------------------------------------
// Nativo: ML Kit (import perezoso)
// ---------------------------------------------------------------------------

async function scanNative(): Promise<BarcodeScanResult> {
  try {
    const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");

    let permission = await BarcodeScanner.checkPermissions();
    if (permission.camera !== "granted" && permission.camera !== "limited") {
      permission = await BarcodeScanner.requestPermissions();
    }
    if (permission.camera !== "granted" && permission.camera !== "limited") {
      return { status: "permission-denied", message: CAMERA_PERMISSION_DENIED_MESSAGE };
    }

    const { barcodes } = await BarcodeScanner.scan();
    const first = barcodes[0];
    const value = (first?.rawValue || first?.displayValue || "").trim();
    if (!value) return { status: "cancelled" };
    return { status: "found", barcode: value };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/cancel/i.test(message)) return { status: "cancelled" };
    return { status: "unavailable", message: "No se pudo iniciar el escaner de código de barras." };
  }
}

// ---------------------------------------------------------------------------
// Web: `BarcodeDetector` nativo del navegador (sin plugin, sin costo de bundle)
// ---------------------------------------------------------------------------

interface WebDetectedBarcode {
  rawValue: string;
}

interface WebBarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<WebDetectedBarcode[]>;
}

interface WebBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): WebBarcodeDetectorInstance;
}

declare global {
  interface Window {
    BarcodeDetector?: WebBarcodeDetectorConstructor;
  }
}

const WEB_SCAN_TIMEOUT_MS = 25_000;
const WEB_SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"];

/**
 * Abre la camara del navegador en `videoElement` y detecta códigos de barras
 * cuadro a cuadro hasta encontrar uno, agotar el tiempo límite o abortar via
 * `signal`. El llamador es responsable de montar/desmontar el `<video>`.
 */
export async function scanWithWebDetector(videoElement: HTMLVideoElement, signal?: AbortSignal): Promise<BarcodeScanResult> {
  if (!hasGlobalBarcodeDetector()) {
    return { status: "unavailable", message: "Este navegador no soporta lectura automática de códigos de barras." };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { status: "unavailable", message: "Este navegador no tiene acceso a la camara." };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { status: "permission-denied", message: CAMERA_PERMISSION_DENIED_MESSAGE };
    }
    return { status: "unavailable", message: "No se pudo acceder a la camara." };
  }

  const DetectorCtor = window.BarcodeDetector;
  if (!DetectorCtor) {
    stream.getTracks().forEach((track) => track.stop());
    return { status: "unavailable", message: "Este navegador no soporta lectura automática de códigos de barras." };
  }

  videoElement.srcObject = stream;
  try {
    await videoElement.play();
  } catch {
    // algunos navegadores exigen interaccion previa del usuario para autoplay;
    // el elemento sigue transmitiendo, el loop de deteccion continua igual.
  }

  const detector = new DetectorCtor({ formats: WEB_SCAN_FORMATS });

  return new Promise<BarcodeScanResult>((resolve) => {
    let settled = false;
    let rafId = 0;

    const finish = (result: BarcodeScanResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (rafId) cancelAnimationFrame(rafId);
      signal?.removeEventListener("abort", onAbort);
      stream.getTracks().forEach((track) => track.stop());
      videoElement.srcObject = null;
      resolve(result);
    };

    const onAbort = () => finish({ status: "cancelled" });
    signal?.addEventListener("abort", onAbort);

    const timeoutId = window.setTimeout(() => finish({ status: "cancelled" }), WEB_SCAN_TIMEOUT_MS);

    const tick = async () => {
      if (settled) return;
      try {
        const results = await detector.detect(videoElement);
        const value = results[0]?.rawValue?.trim();
        if (value) {
          finish({ status: "found", barcode: value });
          return;
        }
      } catch {
        // cuadro ilegible (video aún no listo, etc.): se reintenta en el siguiente frame
      }
      if (!settled) rafId = requestAnimationFrame(() => void tick());
    };
    void tick();
  });
}

// ---------------------------------------------------------------------------
// Punto de entrada único
// ---------------------------------------------------------------------------

/**
 * Escanea según la capacidad indicada. `videoElement` es obligatorio para
 * `"web-detector"` (el llamador lo monta antes de invocar esta funcion);
 * `"manual"` nunca abre camara, la UI debe ofrecer un campo de texto.
 */
export async function scanBarcode(
  capability: BarcodeCapability,
  videoElement?: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<BarcodeScanResult> {
  if (capability === "native") return scanNative();
  if (capability === "web-detector") {
    if (!videoElement) {
      return { status: "unavailable", message: "Falta el elemento de video para escanear." };
    }
    return scanWithWebDetector(videoElement, signal);
  }
  return {
    status: "unavailable",
    message: "Este dispositivo no soporta escaneo automático. Ingresa el código manualmente.",
  };
}
