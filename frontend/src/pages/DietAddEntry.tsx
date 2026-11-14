import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ApiError,
  createDietEntry,
  createDietFood,
  getDietFoodByBarcode,
  uploadDietFoodPhoto,
  type FoodProduct,
  type FoodProductCreatePayload,
  type MealEntryCreatePayload,
  type MealSlot,
} from "../api";
import {
  consumedAtForDay,
  mealSlotKey,
  parseOptionalNumber,
  todayKey,
  useMealSlots,
} from "../lib/nutrition/dietApi";
import { formatDayLong, parseDayKey } from "../lib/dates";
import { currentBarcodeCapability, scanBarcode, type BarcodeCapability, type BarcodeScanResult } from "../lib/nutrition/barcode";
import { classifyBarcodeLookup, nextCaptureStep, PHOTO_FORM_MACRO_KEYS } from "../lib/nutrition/capture";
import type { FoodCategoryGroup } from "../lib/nutrition/foodCategories";
import { defaultQuantityFor, errorMessage, type CaptureMode, type ScanStatus } from "../lib/nutrition/addEntryForm";
import { baseUnitLabel, toBaseQuantity, type QuantityUnitKey } from "../lib/nutrition/units";
import { enqueueMealEntry } from "../lib/nutrition/mealOutbox";
import { isNetworkError } from "../lib/sessionOutbox";
import { useAthleteId } from "../state/athlete";
import FoodBrowser from "./dietAddEntry/FoodBrowser";
import MealSlotField from "./dietAddEntry/MealSlotField";
import PhotoPanel from "./dietAddEntry/PhotoPanel";
import ScanPanel from "./dietAddEntry/ScanPanel";
import SelectedFoodCard from "./dietAddEntry/SelectedFoodCard";
import { useFoodSearch } from "./dietAddEntry/useFoodSearch";
import { usePhotoCapture } from "./dietAddEntry/usePhotoCapture";
import "../styles.ajustes.css";
import { NAV_DELAY_MS } from "../lib/ui";

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

  const [selectedFood, setSelectedFood] = useState<FoodProduct | null>(preselected);
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

  const {
    query,
    setQuery,
    results,
    setResults,
    searching,
    setCategoryKey,
    activeCategory,
    recentFoods,
    categoryGroups,
  } = useFoodSearch(athleteId, selectedFood);

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

  const photo = usePhotoCapture(setError);

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

  function openPhotoFlow(barcode: string | null) {
    photo.resetPhotoForm(barcode);
    setScanStatus("idle");
    setError("");
    setMode("photo");
  }

  // -------------------------------------------------------------------------
  // Flujo de registro por foto (doc modulo-dieta.md #6.5)
  // -------------------------------------------------------------------------

  async function savePhotoCapture() {
    if (!athleteId) return;
    const name = photo.photoName.trim();
    if (!name) {
      setError("El nombre del alimento es obligatorio.");
      return;
    }
    const qty = parseOptionalNumber(photo.photoQuantity);
    const photoServingG = parseOptionalNumber(photo.photoServingSizeG);
    if (!qty || toBaseQuantity(qty, photo.photoQuantityUnit, photoServingG) === null) {
      setError("Ingresa una cantidad válida.");
      return;
    }

    setSaving(true);
    setError("");
    setMsg("");
    try {
      const payload: FoodProductCreatePayload = {
        barcode: photo.photoBarcodeInput.trim() || null,
        name,
        brand: photo.photoBrand.trim() || null,
        basis: photo.photoBasis,
        serving_size_g: photoServingG,
        serving_label: photo.photoServingLabel,
      };
      for (const key of PHOTO_FORM_MACRO_KEYS) {
        payload[key] = parseOptionalNumber(photo.photoMacros[key].text);
      }

      const food = await createDietFood(payload);

      if (photo.frontPhoto) {
        await uploadDietFoodPhoto(food.id, "front", photo.frontPhoto.blob);
      }
      if (photo.nutritionPhoto) {
        await uploadDietFoodPhoto(food.id, "nutrition", photo.nutritionPhoto.blob);
      }

      await createDietEntry({
        athlete_id: athleteId,
        consumed_at: consumedAtForDay(targetDayKey),
        meal_slot: mealSlot,
        food_product_id: food.id,
        quantity_value: qty,
        quantity_unit: photo.photoQuantityUnit,
        notes: notes.trim() || null,
      });

      setMsg("Alimento y comida registrados.");
      setTimeout(() => nav(`/diet?day=${targetDayKey}`), NAV_DELAY_MS);
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
      setTimeout(() => nav(`/diet?day=${targetDayKey}`), NAV_DELAY_MS);
    } catch (cause: unknown) {
      if (payload && isNetworkError(cause)) {
        // Puede que el servidor ya haya comiteado antes del timeout; el
        // client_ref generado al encolar evita que un reintento la duplique.
        enqueueMealEntry(payload);
        setMsg("Sin conexión: la comida quedo guardada y se subira sola al reconectar.");
        setTimeout(() => nav(`/diet?day=${targetDayKey}`), NAV_DELAY_MS);
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

  const mealSlotField = (
    <MealSlotField
      mealSlots={mealSlots}
      mealSlot={mealSlot}
      activeSlotLabel={activeSlotLabel}
      open={slotPickerOpen}
      onOpen={() => setSlotPickerOpen(true)}
      onPick={pickMealSlot}
    />
  );

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Registrar comida</h1>
        {isOtherDay ? <p className="small">{formatDayLong(parseDayKey(targetDayKey))}</p> : null}
      </header>

      {error ? <section className="message error">{error}</section> : null}
      {msg ? <section className="message">{msg}</section> : null}

      {mode === "scan" ? (
        <ScanPanel
          scanCapability={scanCapability}
          scanStatus={scanStatus}
          scanMessage={scanMessage}
          manualBarcodeInput={manualBarcodeInput}
          onManualBarcodeChange={setManualBarcodeInput}
          onSubmitManual={submitManualBarcode}
          onCancel={cancelScan}
          videoRef={videoRef}
        />
      ) : null}

      {mode === "photo" ? (
        <PhotoPanel
          barcode={photo.photoBarcodeInput}
          onBarcodeChange={photo.setPhotoBarcodeInput}
          name={photo.photoName}
          onNameChange={photo.setPhotoName}
          brand={photo.photoBrand}
          onBrandChange={photo.setPhotoBrand}
          basis={photo.photoBasis}
          onBasisChange={photo.setPhotoBasis}
          servingSizeText={photo.photoServingSizeG}
          servingSizeG={parseOptionalNumber(photo.photoServingSizeG)}
          onServingSizeChange={photo.setPhotoServingSizeG}
          macros={photo.photoMacros}
          onMacroChange={photo.updatePhotoMacro}
          quantity={photo.photoQuantity}
          onQuantityChange={photo.setPhotoQuantity}
          quantityUnit={photo.photoQuantityUnit}
          onQuantityUnitChange={photo.setPhotoQuantityUnit}
          notes={notes}
          onNotesChange={setNotes}
          frontPhoto={photo.frontPhoto}
          nutritionPhoto={photo.nutritionPhoto}
          onCapturePhoto={(kind) => void photo.handleCapturePhoto(kind)}
          frontFileInputRef={photo.frontFileInputRef}
          nutritionFileInputRef={photo.nutritionFileInputRef}
          onFileInputChange={photo.handleFileInputChange}
          ocrRunning={photo.ocrRunning}
          ocrWarning={photo.ocrWarning}
          mealSlotField={mealSlotField}
          saving={saving}
          canSave={!!athleteId}
          onSave={() => void savePhotoCapture()}
          onCancel={() => setMode("search")}
        />
      ) : null}

      {showCaptureHooks ? (
        <section className="surface stack compactStack">
          {mealSlotField}

          <div>
            <span className="smallLabel">Alimento</span>
            {selectedFood ? (
              <SelectedFoodCard
                food={selectedFood}
                quantity={quantity}
                onQuantityChange={setQuantity}
                quantityUnit={quantityUnit}
                onQuantityUnitChange={setQuantityUnit}
                previewQty={previewQty}
                baseQuantityHint={baseQuantityHint}
                onClear={clearFood}
              />
            ) : (
              <FoodBrowser
                query={query}
                onQueryChange={setQuery}
                activeCategory={activeCategory}
                categoryGroups={categoryGroups}
                recentFoods={recentFoods}
                results={results}
                searching={searching}
                onPickFood={pickFood}
                onPickCategory={pickCategory}
                onScan={startScanFlow}
                onPhoto={() => openPhotoFlow(null)}
                quantity={quantity}
                onQuantityChange={setQuantity}
                quantityUnit={quantityUnit}
                onQuantityUnitChange={setQuantityUnit}
                manualKcal={manualKcal}
                onManualKcalChange={setManualKcal}
                manualProtein={manualProtein}
                onManualProteinChange={setManualProtein}
                manualCarbs={manualCarbs}
                onManualCarbsChange={setManualCarbs}
                manualFat={manualFat}
                onManualFatChange={setManualFat}
              />
            )}
          </div>

          <label>
            <span className="smallLabel">Notas (opcional)</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="quickActions">
            <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || !athleteId}>
              {saving ? "Guardando..." : "Registrar comida"}
            </button>
            <button type="button" className="btn" onClick={() => nav(-1)} disabled={saving}>
              Cancelar
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
