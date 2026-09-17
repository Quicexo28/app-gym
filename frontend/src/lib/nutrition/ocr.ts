/**
 * OCR de etiquetas nutricionales (doc `modulo-dieta.md` #6.5).
 *
 * La interfaz `OcrProvider` existe para poder enchufar un proveedor basado
 * en la API de Claude (vision) más adelante SIN tocar la UI: `DietAddEntry`
 * solo conoce `recognize(image) -> string[]`, nunca el detalle de que motor
 * lo resuelve. Se mantiene mínima a proposito.
 *
 * `MlKitOcrProvider` es la única implementacion hoy, solo nativa
 * (`@capacitor-mlkit/text-recognition`, import perezoso para no entrar al
 * bundle web). En web, sin proveedor disponible, la UI cae directo al
 * formulario manual — no hay OCR en el navegador.
 */

import { Capacitor } from "@capacitor/core";

/** Entrada de imagen para un proveedor de OCR. Cada proveedor exige lo que necesite. */
export type OcrImage = {
  /** Ruta local de archivo (nativo): la usan los proveedores on-device. */
  path?: string;
  /** Bytes de la imagen: los usaria un proveedor basado en red (ej. vision API). */
  blob?: Blob;
};

export interface OcrProvider {
  /** Devuelve las líneas de texto reconocidas, en orden de lectura. */
  recognize(image: OcrImage): Promise<string[]>;
}

/** ML Kit Text Recognition on-device. Solo nativo (Android/iOS). */
export class MlKitOcrProvider implements OcrProvider {
  async recognize(image: OcrImage): Promise<string[]> {
    if (!image.path) {
      throw new Error("MlKitOcrProvider requiere `path` (ruta local de archivo).");
    }
    const { TextRecognition } = await import("@capacitor-mlkit/text-recognition");
    const result = await TextRecognition.processImage({ path: image.path });
    return result.blocks
      .flatMap((block) => block.lines.map((line) => line.text))
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}

export type OcrProviderEnv = { isNative: boolean };

/** Selecciona el proveedor de OCR disponible. `null` = sin OCR, cae al formulario manual. */
export function selectOcrProvider(env: OcrProviderEnv): OcrProvider | null {
  if (env.isNative) return new MlKitOcrProvider();
  return null;
}

/** Versión impura de `selectOcrProvider`: lee la plataforma real. */
export function currentOcrProvider(): OcrProvider | null {
  return selectOcrProvider({ isNative: Capacitor.isNativePlatform() });
}
