import type { RefObject } from "react";

import type { BarcodeCapability } from "../../lib/nutrition/barcode";
import type { ScanStatus } from "../../lib/nutrition/addEntryForm";

export default function ScanPanel({
  scanCapability,
  scanStatus,
  scanMessage,
  manualBarcodeInput,
  onManualBarcodeChange,
  onSubmitManual,
  onCancel,
  videoRef,
}: {
  scanCapability: BarcodeCapability | null;
  scanStatus: ScanStatus;
  scanMessage: string;
  manualBarcodeInput: string;
  onManualBarcodeChange: (value: string) => void;
  onSubmitManual: () => void;
  onCancel: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  return (
    <section className="surface stack compactStack">
      <div className="sectionHead">
        <h3>Escanear código de barras</h3>
        <button type="button" className="btn btnSlim" onClick={onCancel}>
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
              onChange={(e) => onManualBarcodeChange(e.target.value)}
            />
          </label>
          <button type="button" className="btn primary" onClick={onSubmitManual} disabled={!manualBarcodeInput.trim()}>
            Buscar
          </button>
        </div>
      ) : null}
    </section>
  );
}
