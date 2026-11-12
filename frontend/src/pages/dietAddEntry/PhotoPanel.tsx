import type { ReactNode, RefObject } from "react";

import type { FoodBasis } from "../../api";
import QuantityField from "../../components/QuantityField";
import { CONFIDENCE_LABEL_ES, decideFoodOwnership, PHOTO_FORM_MACRO_KEYS, type PhotoFormMacroKey } from "../../lib/nutrition/capture";
import { PHOTO_MACRO_LABELS, type CapturedPhotoState, type PhotoMacroForm } from "../../lib/nutrition/addEntryForm";
import type { QuantityUnitKey } from "../../lib/nutrition/units";

export default function PhotoPanel({
  barcode,
  onBarcodeChange,
  name,
  onNameChange,
  brand,
  onBrandChange,
  basis,
  onBasisChange,
  servingSizeText,
  servingSizeG,
  onServingSizeChange,
  macros,
  onMacroChange,
  quantity,
  onQuantityChange,
  quantityUnit,
  onQuantityUnitChange,
  notes,
  onNotesChange,
  frontPhoto,
  nutritionPhoto,
  onCapturePhoto,
  frontFileInputRef,
  nutritionFileInputRef,
  onFileInputChange,
  ocrRunning,
  ocrWarning,
  mealSlotField,
  saving,
  canSave,
  onSave,
  onCancel,
}: {
  barcode: string;
  onBarcodeChange: (value: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  brand: string;
  onBrandChange: (value: string) => void;
  basis: FoodBasis;
  onBasisChange: (basis: FoodBasis) => void;
  servingSizeText: string;
  servingSizeG: number | null;
  onServingSizeChange: (value: string) => void;
  macros: PhotoMacroForm;
  onMacroChange: (key: PhotoFormMacroKey, text: string) => void;
  quantity: string;
  onQuantityChange: (value: string) => void;
  quantityUnit: QuantityUnitKey;
  onQuantityUnitChange: (unit: QuantityUnitKey) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  frontPhoto: CapturedPhotoState | null;
  nutritionPhoto: CapturedPhotoState | null;
  onCapturePhoto: (kind: "front" | "nutrition") => void;
  frontFileInputRef: RefObject<HTMLInputElement | null>;
  nutritionFileInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: (kind: "front" | "nutrition", file: File | null) => void;
  ocrRunning: boolean;
  ocrWarning: string;
  mealSlotField: ReactNode;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="surface stack compactStack">
      <div className="sectionHead">
        <h3>Registro por foto</h3>
        <button type="button" className="btn btnSlim" onClick={onCancel}>
          Cancelar
        </button>
      </div>

      <p className="small">{decideFoodOwnership(barcode).noteEs}</p>

      <div className="photoCompare">
        <figure className="photoCompareItem">
          <figcaption className="small">Foto frontal (opcional)</figcaption>
          {frontPhoto ? <img src={frontPhoto.previewUrl} alt="Foto frontal del producto" /> : null}
          <button type="button" className="btn btnSlim" onClick={() => onCapturePhoto("front")}>
            {frontPhoto ? "Repetir foto frontal" : "Tomar foto frontal"}
          </button>
        </figure>
        <figure className="photoCompareItem">
          <figcaption className="small">Tabla nutricional</figcaption>
          {nutritionPhoto ? <img src={nutritionPhoto.previewUrl} alt="Foto de la tabla nutricional" /> : null}
          <button type="button" className="btn btnSlim" onClick={() => onCapturePhoto("nutrition")}>
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
          onFileInputChange("front", e.target.files?.[0] || null);
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
          onFileInputChange("nutrition", e.target.files?.[0] || null);
          e.target.value = "";
        }}
      />

      {ocrRunning ? <div className="emptyState">Leyendo la etiqueta...</div> : null}
      {ocrWarning ? <div className="message">{ocrWarning}</div> : null}

      <label>
        <span className="smallLabel">Nombre del alimento</span>
        <input className="input" value={name} onChange={(e) => onNameChange(e.target.value)} />
      </label>
      <label>
        <span className="smallLabel">Marca (opcional)</span>
        <input className="input" value={brand} onChange={(e) => onBrandChange(e.target.value)} />
      </label>
      <label>
        <span className="smallLabel">Código de barras (opcional)</span>
        <input
          className="input"
          inputMode="numeric"
          placeholder="Puedes agregarlo más adelante"
          value={barcode}
          onChange={(e) => onBarcodeChange(e.target.value)}
        />
      </label>

      <div>
        <span className="smallLabel">Los valores de abajo son por</span>
        <div className="chipRow">
          <button
            type="button"
            className={`chipButton ${basis === "per_100g" ? "activeChipButton" : ""}`}
            onClick={() => onBasisChange("per_100g")}
          >
            100 g
          </button>
          <button
            type="button"
            className={`chipButton ${basis === "per_100ml" ? "activeChipButton" : ""}`}
            onClick={() => onBasisChange("per_100ml")}
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
          value={servingSizeText}
          onChange={(e) => onServingSizeChange(e.target.value)}
        />
      </label>

      <div className="bodyMetricGrid">
        {PHOTO_FORM_MACRO_KEYS.map((key) => {
          const field = macros[key];
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
              <input className="input" inputMode="decimal" value={field.text} onChange={(e) => onMacroChange(key, e.target.value)} />
            </label>
          );
        })}
      </div>

      {mealSlotField}

      <QuantityField
        label="Cantidad a registrar"
        value={quantity}
        onValueChange={onQuantityChange}
        unit={quantityUnit}
        onUnitChange={onQuantityUnitChange}
        basis={basis}
        servingSizeG={servingSizeG}
      />

      <label>
        <span className="smallLabel">Notas (opcional)</span>
        <input className="input" value={notes} onChange={(e) => onNotesChange(e.target.value)} />
      </label>

      <div className="quickActions">
        <button type="button" className="btn primary" onClick={onSave} disabled={saving || !canSave}>
          {saving ? "Guardando..." : "Registrar alimento"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
