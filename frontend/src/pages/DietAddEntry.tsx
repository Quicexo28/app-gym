import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

import {
  ApiError,
  createDietEntry,
  createDietFood,
  getDietFoodByBarcode,
  getDietFoodCategories,
  getRecentDietFoods,
  searchDietFoods,
  uploadDietFoodPhoto,
  type FoodBasis,
  type FoodProduct,
  type FoodProductCreatePayload,
  type MealEntryCreatePayload,
  type MealSlot,
} from "../api";
import {
  consumedAtForDay,
  mealSlotKey,
  parseOptionalNumber,
  scalePer100g,
  todayKey,
  useMealSlots,
} from "../lib/nutrition/dietApi";
import QuantityField from "../components/QuantityField";
import { formatDayLong, parseDayKey } from "../lib/dates";
import { currentBarcodeCapability, scanBarcode, type BarcodeCapability, type BarcodeScanResult } from "../lib/nutrition/barcode";
import {
  buildLabelPrefill,
  classifyBarcodeLookup,
  CONFIDENCE_LABEL_ES,
  decideFoodOwnership,
  nextCaptureStep,
  PHOTO_FORM_MACRO_KEYS,
  type PhotoFormMacroKey,
} from "../lib/nutrition/capture";
import {
  foodCategoryGroup,
  visibleFoodCategoryGroups,
  type FoodCategoryGroup,
} from "../lib/nutrition/foodCategories";
import { foodEmoji } from "../lib/nutrition/foodEmoji";
import { parseNutritionLabel } from "../lib/nutrition/labelParser";
import {
  baseUnitLabel,
  defaultUnitForBasis,
  toBaseQuantity,
  type QuantityUnitKey,
} from "../lib/nutrition/units";
import { enqueueMealEntry } from "../lib/nutrition/mealOutbox";
import { currentOcrProvider } from "../lib/nutrition/ocr";
import { captureNativePhoto } from "../lib/nutrition/photoCapture";
import type { ConfidenceLevel } from "../lib/nutrition/types";
import { isNetworkError } from "../lib/sessionOutbox";
import { useAthleteId } from "../state/athlete";

// Se lee una sola vez fuera del render (mismo patron que `Login.tsx`): leer la
// plataforma es una operacion pura, pero conviene no repetirla en cada pintado.
const isNativeApp = Capacitor.isNativePlatform();

type CaptureMode = "search" | "scan" | "photo";
type ScanStatus = "idle" | "scanning" | "looking-up" | "error";

const PHOTO_MACRO_LABELS: Record<PhotoFormMacroKey, string> = {
  energy_kcal: "Energía (kcal)",
  protein_g: "Proteína (g)",
  carbs_g: "Carbohidratos (g)",
  sugars_g: "Azucares (g)",
  fiber_g: "Fibra (g)",
  fat_g: "Grasas (g)",
  sat_fat_g: "Grasa saturada (g)",
  sodium_mg: "Sodio (mg)",
};

type PhotoMacroFieldState = { text: string; suggested: boolean; confidence?: ConfidenceLevel };
type PhotoMacroForm = Record<PhotoFormMacroKey, PhotoMacroFieldState>;

function emptyPhotoMacroForm(): PhotoMacroForm {
  const form = {} as PhotoMacroForm;
  for (const key of PHOTO_FORM_MACRO_KEYS) {
    form[key] = { text: "", suggested: false };
  }
  return form;
}

type CapturedPhotoState = { blob: Blob; previewUrl: string; ocrPath: string | null };

function errorMessage(cause: unknown): string {
  return String((cause as { message?: string })?.message || cause);
}

/**
 * Cantidad con la que arranca el formulario para un alimento.
 *
 * Con tamano de porcion conocido, "1 porcion" es la respuesta correcta casi
 * siempre y ahorra que el usuario traduzca a gramos. Sin el, 100 de la unidad
 * base es el default de toda la vida (los macros del catálogo vienen por 100).
 */
function defaultQuantityFor(food: FoodProduct | null): { value: string; unit: QuantityUnitKey } {
  if (food?.serving_size_g && food.serving_size_g > 0) {
    return { value: "1", unit: "porcion" };
  }
  return { value: "100", unit: defaultUnitForBasis(food?.basis) };
}

export default function DietAddEntry() {
  const nav = useNavigate();
  const location = useLocation();
  const [athleteId] = useAthleteId();

  const preselected = (location.state as { food?: FoodProduct } | null)?.food || null;

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const dayParam = searchParams.get("day");
  const slotParam = searchParams.get("slot");
  const targetDayKey = dayParam || todayKey();
  const isOtherDay = targetDayKey !== todayKey();

  const { slots: mealSlots } = useMealSlots(athleteId);
  const [mealSlot, setMealSlot] = useState<MealSlot>(slotParam || mealSlotKey(0));
  const mealSlotTouchedRef = useRef(slotParam !== null);
  // Cuando la comida llega decidida desde la card del día (`?slot=`) el selector
  // arranca cerrado: repetirlo entero dentro de "Registrar comida" era redundante.
  const [slotPickerOpen, setSlotPickerOpen] = useState(slotParam === null);
  const [mode, setMode] = useState<CaptureMode>("search");
  const [notes, setNotes] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFood, setSelectedFood] = useState<FoodProduct | null>(preselected);
  // Explorar sin escribir: el buscador arranca en los atajos (recientes +
  // categorias) y solo cae a la lista de resultados cuando hay termino o
  // categoria elegida. Ver `lib/nutrition/foodCategories.ts`.
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [recentFoods, setRecentFoods] = useState<FoodProduct[]>([]);
  // La cantidad se escribe en la unidad que el usuario prefiera y el backend la
  // convierte (ver `lib/nutrition/units.ts`). Si el alimento sabe cuanto pesa
  // una porcion se arranca en "1 porcion", que es como la gente piensa la
  // comida; si no, en 100 de su unidad base.
  const initialQuantity = defaultQuantityFor(preselected);
  const [quantity, setQuantity] = useState(initialQuantity.value);
  const [quantityUnit, setQuantityUnit] = useState<QuantityUnitKey>(initialQuantity.unit);

  const [manualKcal, setManualKcal] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // --- Escaneo de código de barras ---
  const [scanCapability, setScanCapability] = useState<BarcodeCapability | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [manualBarcodeInput, setManualBarcodeInput] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // --- Registro por foto ---
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

  // Preselecciona la primera comida configurada del atleta en cuanto carga, mientras no la haya tocado a mano.
  useEffect(() => {
    if (mealSlotTouchedRef.current || mealSlots.length === 0) return;
    setMealSlot(mealSlots[0].key);
  }, [mealSlots]);

  function pickMealSlot(slot: MealSlot) {
    mealSlotTouchedRef.current = true;
    setMealSlot(slot);
    setSlotPickerOpen(false);
  }

  const activeCategory = useMemo(() => foodCategoryGroup(categoryKey), [categoryKey]);

  // Las categorias del catálogo se piden una vez: solo sirven para no ofrecer
  // grupos que abririan vacios.
  useEffect(() => {
    getDietFoodCategories()
      .then(setCatalogCategories)
      .catch(() => setCatalogCategories([]));
  }, []);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    getRecentDietFoods(athleteId, 8)
      .then((rows) => {
        if (!cancelled) setRecentFoods(rows);
      })
      .catch(() => {
        if (!cancelled) setRecentFoods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  // Con categoria elegida el termino vacio es válido: lista el grupo entero
  // (el backend admite `q=""`), y escribir filtra dentro de ese grupo.
  useEffect(() => {
    const term = query.trim();
    if (selectedFood || (!term && !activeCategory)) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setSearching(true);
      searchDietFoods({
        q: term,
        scope: "all",
        category: activeCategory ? activeCategory.tcac : undefined,
        limit: activeCategory ? 60 : undefined,
      })
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, term ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, selectedFood, activeCategory]);

  // El escaneo con BarcodeDetector web necesita el <video> ya montado en el
  // DOM (mode === "scan"), así que arranca desde un efecto en vez de desde el
  // manejador del boton.
  useEffect(() => {
    if (mode !== "scan" || scanCapability !== "web-detector") return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let cancelled = false;
    const controller = new AbortController();
    setScanStatus("scanning");
    scanBarcode("web-detector", videoEl, controller.signal)
      .then((result) => {
        if (!cancelled) void handleScanResult(result);
      })
      .catch(() => {
        if (!cancelled) void handleScanResult({ status: "unavailable", message: "No se pudo escanear." });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scanCapability]);

  // Libera los object URLs de las fotos capturadas al desmontar la pantalla.
  useEffect(() => {
    return () => {
      if (frontPhoto) URL.revokeObjectURL(frontPhoto.previewUrl);
      if (nutritionPhoto) URL.revokeObjectURL(nutritionPhoto.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickFood(food: FoodProduct) {
    const next = defaultQuantityFor(food);
    setSelectedFood(food);
    setQuantity(next.value);
    setQuantityUnit(next.unit);
    setError("");
  }

  function pickCategory(group: FoodCategoryGroup | null) {
    setCategoryKey(group ? group.key : null);
    setQuery("");
    setResults([]);
    setError("");
  }

  function clearFood() {
    const next = defaultQuantityFor(null);
    setSelectedFood(null);
    setQuery("");
    setResults([]);
    setCategoryKey(null);
    setQuantity(next.value);
    setQuantityUnit(next.unit);
    setManualKcal("");
    setManualProtein("");
    setManualCarbs("");
    setManualFat("");
  }

  // -------------------------------------------------------------------------
  // Flujo de escaneo (doc modulo-dieta.md #6.5)
  // -------------------------------------------------------------------------

  function startScanFlow() {
    setError("");
    setMsg("");
    setManualBarcodeInput("");
    const capability = currentBarcodeCapability();
    setScanCapability(capability);
    setScanMessage("");
    setMode("scan");

    if (capability === "manual") {
      setScanStatus("error");
      setScanMessage("Este dispositivo no soporta escaneo automático. Escribe el código de barras.");
      return;
    }
    if (capability === "native") {
      setScanStatus("scanning");
      scanBarcode("native")
        .then((result) => void handleScanResult(result))
        .catch(() => void handleScanResult({ status: "unavailable", message: "No se pudo escanear." }));
      return;
    }
    // "web-detector": el efecto de arriba arranca el escaneo cuando el <video> este montado.
  }

  async function handleScanResult(result: BarcodeScanResult) {
    if (result.status === "cancelled") {
      setMode("search");
      setScanStatus("idle");
      return;
    }
    if (result.status === "permission-denied" || result.status === "unavailable") {
      setScanStatus("error");
      setScanMessage(result.message);
      return;
    }
    await lookupBarcode(result.barcode);
  }

  async function lookupBarcode(barcode: string) {
    setScanStatus("looking-up");
    try {
      const food = await getDietFoodByBarcode(barcode);
      const outcome = classifyBarcodeLookup({ ok: true });
      if (nextCaptureStep(outcome) === "confirm-quantity") {
        pickFood(food);
        setMode("search");
      }
    } catch (cause: unknown) {
      const status = cause instanceof ApiError ? cause.status : 0;
      const message = cause instanceof ApiError ? cause.detail : errorMessage(cause);
      const outcome = classifyBarcodeLookup({ ok: false, status, message });
      const step = nextCaptureStep(outcome);
      if (step === "photo-capture") {
        openPhotoFlow(barcode);
      } else {
        setScanStatus("error");
        setScanMessage(message);
      }
    }
  }

  function submitManualBarcode() {
    const value = manualBarcodeInput.trim();
    if (!value) return;
    void lookupBarcode(value);
  }

  function cancelScan() {
    setMode("search");
    setScanStatus("idle");
    setScanMessage("");
  }

  // -------------------------------------------------------------------------
  // Flujo de registro por foto (doc modulo-dieta.md #6.5)
  // -------------------------------------------------------------------------

  function openPhotoFlow(barcode: string | null) {
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
    setScanStatus("idle");
    setError("");
    setMode("photo");
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

  async function savePhotoCapture() {
    if (!athleteId) return;
    const name = photoName.trim();
    if (!name) {
      setError("El nombre del alimento es obligatorio.");
      return;
    }
    const qty = parseOptionalNumber(photoQuantity);
    const photoServingG = parseOptionalNumber(photoServingSizeG);
    if (!qty || toBaseQuantity(qty, photoQuantityUnit, photoServingG) === null) {
      setError("Ingresa una cantidad válida.");
      return;
    }

    setSaving(true);
    setError("");
    setMsg("");
    try {
      const payload: FoodProductCreatePayload = {
        barcode: photoBarcodeInput.trim() || null,
        name,
        brand: photoBrand.trim() || null,
        basis: photoBasis,
        serving_size_g: photoServingG,
        serving_label: photoServingLabel,
      };
      for (const key of PHOTO_FORM_MACRO_KEYS) {
        payload[key] = parseOptionalNumber(photoMacros[key].text);
      }

      const food = await createDietFood(payload);

      if (frontPhoto) {
        await uploadDietFoodPhoto(food.id, "front", frontPhoto.blob);
      }
      if (nutritionPhoto) {
        await uploadDietFoodPhoto(food.id, "nutrition", nutritionPhoto.blob);
      }

      await createDietEntry({
        athlete_id: athleteId,
        consumed_at: consumedAtForDay(targetDayKey),
        meal_slot: mealSlot,
        food_product_id: food.id,
        quantity_value: qty,
        quantity_unit: photoQuantityUnit,
        notes: notes.trim() || null,
      });

      setMsg("Alimento y comida registrados.");
      setTimeout(() => nav(`/diet?day=${targetDayKey}`), 400);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Guardado (busqueda / entrada manual)
  // -------------------------------------------------------------------------

  async function save() {
    if (!athleteId) return;
    setSaving(true);
    setError("");
    setMsg("");

    // Se arma antes del try para poder encolarlo tal cual si el POST falla
    // por red (el client_ref lo agrega el outbox al encolar, no aquí).
    let payload: MealEntryCreatePayload | null = null;

    try {
      const qty = parseOptionalNumber(quantity);
      if (!qty || toBaseQuantity(qty, quantityUnit, selectedFood?.serving_size_g) === null) {
        setError("Ingresa una cantidad válida.");
        return;
      }

      if (selectedFood) {
        payload = {
          athlete_id: athleteId,
          consumed_at: consumedAtForDay(targetDayKey),
          meal_slot: mealSlot,
          food_product_id: selectedFood.id,
          quantity_value: qty,
          quantity_unit: quantityUnit,
          notes: notes.trim() || null,
        };
      } else {
        const name = query.trim();
        if (!name) {
          setError("Escribe o selecciona un alimento.");
          return;
        }
        payload = {
          athlete_id: athleteId,
          consumed_at: consumedAtForDay(targetDayKey),
          meal_slot: mealSlot,
          food_name: name,
          quantity_value: qty,
          quantity_unit: quantityUnit,
          energy_kcal: parseOptionalNumber(manualKcal),
          protein_g: parseOptionalNumber(manualProtein),
          carbs_g: parseOptionalNumber(manualCarbs),
          fat_g: parseOptionalNumber(manualFat),
          notes: notes.trim() || null,
        };
      }

      await createDietEntry(payload);
      setMsg("Comida registrada.");
      setTimeout(() => nav(`/diet?day=${targetDayKey}`), 400);
    } catch (cause: unknown) {
      if (payload && isNetworkError(cause)) {
        // Puede que el servidor ya haya comiteado antes del timeout; el
        // client_ref generado al encolar evita que un reintento la duplique.
        enqueueMealEntry(payload);
        setMsg("Sin conexión: la comida quedo guardada y se subira sola al reconectar.");
        setTimeout(() => nav(`/diet?day=${targetDayKey}`), 400);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  }

  // Los macros del catálogo estan por 100 g/ml, así que la vista previa necesita
  // la cantidad ya convertida a esa unidad base, no lo que se escribio.
  const previewQty =
    toBaseQuantity(parseOptionalNumber(quantity) ?? 0, quantityUnit, selectedFood?.serving_size_g) ?? 0;
  // Al medir en porciones/tazas/onzas conviene ver a cuanto equivale: es el
  // número con el que se calculan los macros y el que queda en el historial.
  const baseQuantityHint =
    previewQty > 0
      ? `= ${Math.round(previewQty * 10) / 10} ${baseUnitLabel(selectedFood?.basis, quantityUnit)}`
      : undefined;
  const showCaptureHooks = mode === "search";
  const activeSlotLabel = mealSlots.find((slot) => slot.key === mealSlot)?.label || "Comida";
  const categoryGroups = useMemo(
    () => visibleFoodCategoryGroups(catalogCategories),
    [catalogCategories],
  );
  // Los atajos (recientes + categorias) son la vista por defecto del buscador:
  // se van en cuanto hay algo que listar, para no apilar dos listas de comida.
  const showBrowse = !query.trim() && !activeCategory;

  function renderFoodRow(food: FoodProduct) {
    return (
      <button key={food.id} type="button" className="surfaceButton" onClick={() => pickFood(food)}>
        <strong>
          <span className="foodEmoji" aria-hidden="true">
            {foodEmoji(food.name, food.category)}
          </span>
          {food.name}
        </strong>
        <span className="small">
          {food.brand ? `${food.brand} | ` : ""}
          {food.energy_kcal !== null ? `${Math.round(food.energy_kcal)} kcal / 100 g` : "Sin datos"}
        </span>
      </button>
    );
  }

  // Un solo campo para la comida destino, compartido por el modo busqueda y el
  // modo foto: cerrado muestra a cual se registra, abierto deja cambiarla.
  function renderMealSlotField() {
    if (!slotPickerOpen) {
      return (
        <div className="sectionHead">
          <h3>{activeSlotLabel}</h3>
          {mealSlots.length > 1 ? (
            <button type="button" className="btn btnSlim" onClick={() => setSlotPickerOpen(true)}>
              Cambiar
            </button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="mealSlotPicker">
        {mealSlots.map((slot) => (
          <button
            key={slot.key}
            type="button"
            className={`mealSlotCard ${mealSlot === slot.key ? "activeMealSlotCard" : ""}`}
            onClick={() => pickMealSlot(slot.key)}
          >
            {slot.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Registrar comida</h1>
        {isOtherDay ? <p className="small">{formatDayLong(parseDayKey(targetDayKey))}</p> : null}
      </header>

      {error ? <section className="message error">{error}</section> : null}
      {msg ? <section className="message">{msg}</section> : null}

      {showCaptureHooks ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Captura rápida</h3>
            <p>Escanea el código de barras o toma una foto de la etiqueta.</p>
          </div>
          <div className="captureHookRow" style={{ marginTop: 12 }}>
            <button className="btn" onClick={startScanFlow}>
              Escanear código
            </button>
            <button className="btn" onClick={() => openPhotoFlow(null)}>
              Registrar por foto
            </button>
          </div>
        </section>
      ) : null}

      {mode === "scan" ? (
        <section className="surface stack compactStack">
          <div className="sectionHead">
            <h3>Escanear código de barras</h3>
            <button className="btn btnSlim" onClick={cancelScan}>
              Cancelar
            </button>
          </div>

          {scanCapability === "web-detector" ? (
            <video ref={videoRef} className="barcodeScanVideo" muted playsInline />
          ) : null}

          {scanStatus === "scanning" && scanCapability === "native" ? (
            <div className="emptyState">Abriendo camara...</div>
          ) : null}
          {scanStatus === "scanning" && scanCapability === "web-detector" ? (
            <div className="emptyState">Apunta la camara al código de barras.</div>
          ) : null}
          {scanStatus === "looking-up" ? <div className="emptyState">Buscando el producto...</div> : null}

          {scanStatus === "error" ? <div className="message error">{scanMessage}</div> : null}

          {scanCapability === "manual" || scanStatus === "error" ? (
            <div className="stack compactStack">
              <label>
                <span className="smallLabel">Código de barras</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={manualBarcodeInput}
                  onChange={(e) => setManualBarcodeInput(e.target.value)}
                />
              </label>
              <button className="btn primary" onClick={submitManualBarcode} disabled={!manualBarcodeInput.trim()}>
                Buscar
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {mode === "photo" ? (
        <section className="surface stack compactStack">
          <div className="sectionHead">
            <h3>Registro por foto</h3>
            <button className="btn btnSlim" onClick={() => setMode("search")}>
              Cancelar
            </button>
          </div>

          <p className="small">{decideFoodOwnership(photoBarcodeInput).noteEs}</p>

          <div className="photoCompare">
            <figure className="photoCompareItem">
              <figcaption className="small">Foto frontal (opcional)</figcaption>
              {frontPhoto ? <img src={frontPhoto.previewUrl} alt="Foto frontal del producto" /> : null}
              <button className="btn btnSlim" onClick={() => void handleCapturePhoto("front")}>
                {frontPhoto ? "Repetir foto frontal" : "Tomar foto frontal"}
              </button>
            </figure>
            <figure className="photoCompareItem">
              <figcaption className="small">Tabla nutricional</figcaption>
              {nutritionPhoto ? <img src={nutritionPhoto.previewUrl} alt="Foto de la tabla nutricional" /> : null}
              <button className="btn btnSlim" onClick={() => void handleCapturePhoto("nutrition")}>
                {nutritionPhoto ? "Repetir foto de etiqueta" : "Tomar foto de tabla nutricional"}
              </button>
            </figure>
          </div>

          <input
            ref={frontFileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              handleFileInputChange("front", e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
          <input
            ref={nutritionFileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              handleFileInputChange("nutrition", e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />

          {ocrRunning ? <div className="emptyState">Leyendo la etiqueta...</div> : null}
          {ocrWarning ? <div className="message">{ocrWarning}</div> : null}

          <label>
            <span className="smallLabel">Nombre del alimento</span>
            <input className="input" value={photoName} onChange={(e) => setPhotoName(e.target.value)} />
          </label>
          <label>
            <span className="smallLabel">Marca (opcional)</span>
            <input className="input" value={photoBrand} onChange={(e) => setPhotoBrand(e.target.value)} />
          </label>
          <label>
            <span className="smallLabel">Código de barras (opcional)</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="Puedes agregarlo más adelante"
              value={photoBarcodeInput}
              onChange={(e) => setPhotoBarcodeInput(e.target.value)}
            />
          </label>

          <div>
            <span className="smallLabel">Los valores de abajo son por</span>
            <div className="chipRow">
              <button
                type="button"
                className={`chipButton ${photoBasis === "per_100g" ? "activeChipButton" : ""}`}
                onClick={() => setPhotoBasis("per_100g")}
              >
                100 g
              </button>
              <button
                type="button"
                className={`chipButton ${photoBasis === "per_100ml" ? "activeChipButton" : ""}`}
                onClick={() => setPhotoBasis("per_100ml")}
              >
                100 ml
              </button>
            </div>
          </div>

          <label>
            <span className="smallLabel">Tamano de porcion (g, opcional)</span>
            <input
              className="input"
              inputMode="decimal"
              value={photoServingSizeG}
              onChange={(e) => setPhotoServingSizeG(e.target.value)}
            />
          </label>

          <div className="bodyMetricGrid">
            {PHOTO_FORM_MACRO_KEYS.map((key) => {
              const field = photoMacros[key];
              return (
                <label key={key} className="bodyMetricField">
                  <span className="smallLabel">
                    {PHOTO_MACRO_LABELS[key]}
                    {field.suggested ? (
                      <span className="badge" style={{ marginLeft: 6 }}>
                        {`Sugerido (confianza ${CONFIDENCE_LABEL_ES[field.confidence ?? "low"]})`}
                      </span>
                    ) : null}
                  </span>
                  <input className="input" inputMode="decimal" value={field.text} onChange={(e) => updatePhotoMacro(key, e.target.value)} />
                </label>
              );
            })}
          </div>

          {renderMealSlotField()}

          <QuantityField
            label="Cantidad a registrar"
            value={photoQuantity}
            onValueChange={setPhotoQuantity}
            unit={photoQuantityUnit}
            onUnitChange={setPhotoQuantityUnit}
            basis={photoBasis}
            servingSizeG={parseOptionalNumber(photoServingSizeG)}
          />

          <label>
            <span className="smallLabel">Notas (opcional)</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="quickActions">
            <button className="btn primary" onClick={() => void savePhotoCapture()} disabled={saving || !athleteId}>
              {saving ? "Guardando..." : "Registrar alimento"}
            </button>
            <button className="btn" onClick={() => setMode("search")} disabled={saving}>
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      {showCaptureHooks ? (
        <section className="surface stack compactStack">
          {renderMealSlotField()}

          <div>
            <span className="smallLabel">Alimento</span>
            {selectedFood ? (
              <div className="foodResultCard">
                <div className="foodResultHead">
                  <strong>
                    <span className="foodEmoji" aria-hidden="true">
                      {foodEmoji(selectedFood.name, selectedFood.category)}
                    </span>
                    {selectedFood.name}
                  </strong>
                  <button className="btn btnSlim" onClick={clearFood}>
                    Cambiar
                  </button>
                </div>
                {selectedFood.brand ? <span className="small">{selectedFood.brand}</span> : null}

                <QuantityField
                  value={quantity}
                  onValueChange={setQuantity}
                  unit={quantityUnit}
                  onUnitChange={setQuantityUnit}
                  basis={selectedFood.basis}
                  servingSizeG={selectedFood.serving_size_g}
                  hint={quantityUnit === "g" || quantityUnit === "ml" ? undefined : baseQuantityHint}
                />

                <span className="small">
                  {`Aprox: ${scalePer100g(selectedFood.energy_kcal, previewQty) ?? "—"} kcal | P ${scalePer100g(selectedFood.protein_g, previewQty) ?? "—"} g | C ${scalePer100g(selectedFood.carbs_g, previewQty) ?? "—"} g | G ${scalePer100g(selectedFood.fat_g, previewQty) ?? "—"} g`}
                </span>
              </div>
            ) : (
              <div className="stack compactStack">
                <input
                  className="input"
                  placeholder={activeCategory ? `Buscar en ${activeCategory.label}...` : "Nombre del alimento..."}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />

                {activeCategory ? (
                  <div className="foodBrowseHead">
                    <button type="button" className="chipButton" onClick={() => pickCategory(null)}>
                      ← Categorias
                    </button>
                    <span className="chip">
                      <span className="foodEmoji" aria-hidden="true">
                        {activeCategory.emoji}
                      </span>
                      {activeCategory.label}
                    </span>
                  </div>
                ) : null}

                {showBrowse && recentFoods.length > 0 ? (
                  <div className="foodBrowseBlock">
                    <span className="smallLabel">Recientes</span>
                    <div className="stack compactStack">{recentFoods.map(renderFoodRow)}</div>
                  </div>
                ) : null}

                {showBrowse && categoryGroups.length > 0 ? (
                  <div className="foodBrowseBlock">
                    <span className="smallLabel">Categorias</span>
                    <div className="foodCategoryGrid">
                      {categoryGroups.map((group) => (
                        <button
                          key={group.key}
                          type="button"
                          className="foodCategoryTile"
                          onClick={() => pickCategory(group)}
                        >
                          <span className="foodCategoryEmoji" aria-hidden="true">
                            {group.emoji}
                          </span>
                          <span className="foodCategoryLabel">{group.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {showBrowse ? null : searching ? (
                  <div className="emptyState">Buscando...</div>
                ) : results.length > 0 ? (
                  <div className="stack compactStack">{results.map(renderFoodRow)}</div>
                ) : query.trim() ? (
                  <div className="emptyState">Sin resultados para "{query.trim()}".</div>
                ) : (
                  <div className="emptyState">Sin alimentos en {activeCategory?.label}.</div>
                )}

                {query.trim() ? (
                  <div className="stack compactStack">
                    <p className="small">No esta en el catálogo? Completa los datos y se registra como alimento manual.</p>
                    <div className="bodyMetricGrid">
                      <div className="bodyMetricField">
                        <QuantityField
                          value={quantity}
                          onValueChange={setQuantity}
                          unit={quantityUnit}
                          onUnitChange={setQuantityUnit}
                        />
                      </div>
                      <label className="bodyMetricField">
                        <span className="smallLabel">Energía (kcal)</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={manualKcal}
                          onChange={(e) => setManualKcal(e.target.value)}
                        />
                      </label>
                      <label className="bodyMetricField">
                        <span className="smallLabel">Proteína (g)</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={manualProtein}
                          onChange={(e) => setManualProtein(e.target.value)}
                        />
                      </label>
                      <label className="bodyMetricField">
                        <span className="smallLabel">Carbohidratos (g)</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={manualCarbs}
                          onChange={(e) => setManualCarbs(e.target.value)}
                        />
                      </label>
                      <label className="bodyMetricField">
                        <span className="smallLabel">Grasas (g)</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={manualFat}
                          onChange={(e) => setManualFat(e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <label>
            <span className="smallLabel">Notas (opcional)</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="quickActions">
            <button className="btn primary" onClick={() => void save()} disabled={saving || !athleteId}>
              {saving ? "Guardando..." : "Registrar comida"}
            </button>
            <button className="btn" onClick={() => nav(-1)} disabled={saving}>
              Cancelar
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
