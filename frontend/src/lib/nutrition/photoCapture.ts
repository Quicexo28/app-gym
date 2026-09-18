/**
 * Captura de fotos para el flujo de alimentos (doc `modulo-dieta.md` #6.5),
 * lado nativo. En web se usa un `<input type="file" accept="image/*"
 * capture="environment">` normal (ver `DietAddEntry.tsx`) — no hay costo de
 * bundle ni dependencia nueva para ese caso, así que no vive aquí.
 *
 * `@capacitor/camera` se importa de forma perezosa para que nunca entre al
 * bundle web (mismo criterio que `barcode.ts`/`ocr.ts`).
 */

import { Capacitor } from "@capacitor/core";

export type CapturedPhoto = {
  blob: Blob;
  /** Ruta local de archivo, solo nativo: la consume `MlKitOcrProvider` (ver `ocr.ts`). */
  ocrPath: string | null;
};

export type PhotoCaptureResult =
  | { status: "captured"; photo: CapturedPhoto }
  | { status: "cancelled" }
  | { status: "permission-denied"; message: string }
  | { status: "unavailable"; message: string };

const CAMERA_PERMISSION_DENIED_MESSAGE =
  "Alzo necesita permiso de camara para tomar la foto. Actívalo en Ajustes > Aplicaciones > Alzo > Permisos.";

export function isNativeCameraAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** Abre la camara nativa, pide permiso si hace falta, y devuelve la foto como Blob. */
export async function captureNativePhoto(): Promise<PhotoCaptureResult> {
  try {
    const { Camera } = await import("@capacitor/camera");

    let permission = await Camera.checkPermissions();
    if (permission.camera !== "granted" && permission.camera !== "limited") {
      permission = await Camera.requestPermissions({ permissions: ["camera"] });
    }
    if (permission.camera !== "granted" && permission.camera !== "limited") {
      return { status: "permission-denied", message: CAMERA_PERMISSION_DENIED_MESSAGE };
    }

    const result = await Camera.takePhoto({ quality: 85, correctOrientation: true });
    const source = result.webPath || result.uri;
    if (!source) {
      return { status: "unavailable", message: "No se pudo leer la foto capturada." };
    }

    const response = await fetch(source);
    const blob = await response.blob();
    return { status: "captured", photo: { blob, ocrPath: result.uri || null } };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/cancel/i.test(message)) return { status: "cancelled" };
    return { status: "unavailable", message: "No se pudo abrir la camara." };
  }
}
