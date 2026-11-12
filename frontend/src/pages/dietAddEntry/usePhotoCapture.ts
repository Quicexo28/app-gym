import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

import type { FoodBasis } from "../../api";
import { buildLabelPrefill, PHOTO_FORM_MACRO_KEYS, type PhotoFormMacroKey } from "../../lib/nutrition/capture";
import { parseNutritionLabel } from "../../lib/nutrition/labelParser";
import { currentOcrProvider } from "../../lib/nutrition/ocr";
import { captureNativePhoto } from "../../lib/nutrition/photoCapture";
import type { QuantityUnitKey } from "../../lib/nutrition/units";
import {
  emptyPhotoMacroForm,
  type CapturedPhotoState,
  type PhotoMacroForm,
} from "../../lib/nutrition/addEntryForm";

// Se lee una sola vez fuera del render (mismo patron que `Login.tsx`): leer la
// plataforma es una operacion pura, pero conviene no repetirla en cada pintado.
const isNativeApp = Capacitor.isNativePlatform();

// Estado y acciones del registro por foto (doc modulo-dieta.md #6.5): fotos, OCR de la etiqueta y formulario de macros.
export function usePhotoCapture(setError: (message: string) => void) {
  const [photoBarcodeInput, setPhotoBarcodeInput] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [photoBrand, setPhotoBrand] = useState("");
  const [photoBasis, setPhotoBasis] = useState<FoodBasis>("per_100g");
  const [photoServingSizeG, setPhotoServingSizeG] = useState("");
  const [photoServingLabel, setPhotoServingLabel] = useState<string | null>(null);
  const [photoQuantity, setPhotoQuantity] = useState("100");
  const [photoQuantityUnit, setPhotoQuantityUnit] = useState<QuantityUnitKey>("g");
  const [photoMacros, setPhotoMacros] = useState<PhotoMacroForm>(() => emptyPhotoMacroForm());
  const [frontPhoto, setFrontPhoto] = useState<CapturedPhotoState | null>(null);
  const [nutritionPhoto, setNutritionPhoto] = useState<CapturedPhotoState | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrWarning, setOcrWarning] = useState("");
  const frontFileInputRef = useRef<HTMLInputElement | null>(null);
  const nutritionFileInputRef = useRef<HTMLInputElement | null>(null);

  // Libera los object URLs de las fotos capturadas al desmontar la pantalla.
  useEffect(() => {
    return () => {
      if (frontPhoto) URL.revokeObjectURL(frontPhoto.previewUrl);
      if (nutritionPhoto) URL.revokeObjectURL(nutritionPhoto.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deja el formulario en blanco (liberando las fotos previas) con el codigo de barras de partida.
  function resetPhotoForm(barcode: string | null) {
    if (frontPhoto) URL.revokeObjectURL(frontPhoto.previewUrl);
    if (nutritionPhoto) URL.revokeObjectURL(nutritionPhoto.previewUrl);

    setPhotoBarcodeInput(barcode ?? "");
    setPhotoName("");
    setPhotoBrand("");
    setPhotoBasis("per_100g");
    setPhotoServingSizeG("");
    setPhotoServingLabel(null);
    setPhotoQuantity("100");
    setPhotoMacros(emptyPhotoMacroForm());
    setFrontPhoto(null);
    setNutritionPhoto(null);
    setOcrWarning("");
  }

  async function handleCapturePhoto(kind: "front" | "nutrition") {
    setError("");
    if (isNativeApp) {
      const result = await captureNativePhoto();
      if (result.status === "captured") {
        applyCapturedPhoto(kind, result.photo.blob, result.photo.ocrPath);
      } else if (result.status !== "cancelled") {
        setError(result.message);
      }
      return;
    }
    (kind === "front" ? frontFileInputRef : nutritionFileInputRef).current?.click();
  }

  function handleFileInputChange(kind: "front" | "nutrition", file: File | null) {
    if (!file) return;
    applyCapturedPhoto(kind, file, null);
  }

  function applyCapturedPhoto(kind: "front" | "nutrition", blob: Blob, ocrPath: string | null) {
    const previewUrl = URL.createObjectURL(blob);
    if (kind === "front") {
      setFrontPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { blob, previewUrl, ocrPath };
      });
      return;
    }
    setNutritionPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { blob, previewUrl, ocrPath };
    });
    void runOcr(blob, ocrPath);
  }

  async function runOcr(blob: Blob, ocrPath: string | null) {
    const provider = currentOcrProvider();
    if (!provider) return; // web sin proveedor: se cae al formulario manual, sin aviso de error

    setOcrRunning(true);
    setOcrWarning("");
    try {
      const lines = await provider.recognize({ path: ocrPath ?? undefined, blob });
      const parsed = parseNutritionLabel(lines);
      const prefill = buildLabelPrefill(parsed);

      setPhotoBasis(prefill.basis);
      const nextForm = emptyPhotoMacroForm();
      for (const key of PHOTO_FORM_MACRO_KEYS) {
        const field = prefill.values[key];
        if (field) nextForm[key] = { text: String(field.value), suggested: true, confidence: field.confidence };
      }
      setPhotoMacros(nextForm);

      if (parsed.servingSizeG) {
        setPhotoServingSizeG(String(parsed.servingSizeG));
        setPhotoQuantity(String(parsed.servingSizeG));
      }
      if (parsed.servingSizeRaw) setPhotoServingLabel(parsed.servingSizeRaw);

      setOcrWarning(
        prefill.needsServingSize
          ? "No se pudo determinar el tamano de porcion en gramos. Completa los valores por 100 g manualmente."
          : "",
      );
    } catch {
      setOcrWarning("No se pudo leer el texto de la etiqueta. Completa los valores manualmente.");
    } finally {
      setOcrRunning(false);
    }
  }

  function updatePhotoMacro(key: PhotoFormMacroKey, text: string) {
    setPhotoMacros((prev) => ({ ...prev, [key]: { text, suggested: false } }));
  }

  return {
    photoBarcodeInput,
    setPhotoBarcodeInput,
    photoName,
    setPhotoName,
    photoBrand,
    setPhotoBrand,
    photoBasis,
    setPhotoBasis,
    photoServingSizeG,
    setPhotoServingSizeG,
    photoServingLabel,
    photoQuantity,
    setPhotoQuantity,
    photoQuantityUnit,
    setPhotoQuantityUnit,
    photoMacros,
    frontPhoto,
    nutritionPhoto,
    ocrRunning,
    ocrWarning,
    frontFileInputRef,
    nutritionFileInputRef,
    resetPhotoForm,
    handleCapturePhoto,
    handleFileInputChange,
    updatePhotoMacro,
  };
}
