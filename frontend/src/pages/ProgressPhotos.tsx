import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DatePicker from "../components/DatePicker";
import Select from "../components/Select";
import {
  addProgressPhoto,
  deleteAllProgressPhotos,
  deleteProgressPhoto,
  estimateStorageUsageMb,
  getProgressPhotoBlob,
  listProgressPhotos,
  requestPersistentStorage,
  PROGRESS_PHOTO_POSES,
  type ProgressPhotoMeta,
  type ProgressPhotoPose,
} from "../lib/progressPhotos";
import { formatWeight } from "../lib/units";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";
import { APP_LOCALE } from "../lib/locale";

function todayInputValue(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toIsoFromDateInput(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function formatTakenAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString(APP_LOCALE);
}

export default function ProgressPhotos() {
  const { user } = useAuth();
  const { prefs } = usePreferences();
  const ownerId = user?.id || "";

  const [photos, setPhotos] = useState<ProgressPhotoMeta[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [usageMb, setUsageMb] = useState<number | null>(null);

  const [takenAt, setTakenAt] = useState<string>(() => todayInputValue());
  const [pose, setPose] = useState<ProgressPhotoPose>("frente");
  const [note, setNote] = useState("");
  const [weight, setWeight] = useState("");

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const urlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    urlsRef.current = urls;
  }, [urls]);

  useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!ownerId) {
      setPhotos([]);
      setUrls({});
      return;
    }

    setLoading(true);
    setError("");
    try {
      const items = await listProgressPhotos(ownerId);
      const nextUrls: Record<string, string> = {};
      for (const item of items) {
        const blob = await getProgressPhotoBlob(item.id, ownerId);
        if (blob) nextUrls[item.id] = URL.createObjectURL(blob);
      }

      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      setPhotos(items);
      setUrls(nextUrls);
      setCompareIds((prev) => prev.filter((id) => nextUrls[id]));
      setUsageMb(await estimateStorageUsageMb());
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    void requestPersistentStorage();
    void refresh();
  }, [refresh]);

  async function handleFile(file: File | null) {
    if (!file || !ownerId) return;
    if (!file.type.startsWith("image/")) {
      setError("El archivo debe ser una imagen.");
      return;
    }

    setBusy(true);
    setError("");
    setMsg("");
    try {
      const parsedWeight = Number(weight.trim());
      await addProgressPhoto({
        ownerId,
        file,
        takenAt: toIsoFromDateInput(takenAt),
        pose,
        note: note.trim() || undefined,
        weightKg: weight.trim() && Number.isFinite(parsedWeight) ? parsedWeight : undefined,
      });
      setNote("");
      setWeight("");
      setMsg("Foto guardada solo en este dispositivo.");
      await refresh();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removePhoto(id: string) {
    if (!ownerId) return;
    setBusy(true);
    try {
      await deleteProgressPhoto(id, ownerId);
      setViewerId((prev) => (prev === id ? null : prev));
      setMsg("Foto borrada del dispositivo.");
      await refresh();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    if (!ownerId) return;
    const confirmed = window.confirm(
      "Se borraran TODAS tus fotos de progreso de este dispositivo. No hay copia en el servidor, la acción no se puede deshacer.",
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const total = await deleteAllProgressPhotos(ownerId);
      setViewerId(null);
      setCompareIds([]);
      setMsg(`Borradas ${total} fotos.`);
      await refresh();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((entry) => entry !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  function downloadPhoto(meta: ProgressPhotoMeta) {
    const url = urls[meta.id];
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `progreso_${meta.takenAt.slice(0, 10)}_${meta.pose}.jpg`;
    anchor.click();
  }

  const comparePair = useMemo(
    () => compareIds.map((id) => photos.find((item) => item.id === id)).filter(Boolean) as ProgressPhotoMeta[],
    [compareIds, photos],
  );
  const viewer = useMemo(() => photos.find((item) => item.id === viewerId) || null, [photos, viewerId]);

  if (!ownerId) {
    return (
      <section className="surface">
        <div className="emptyState">Inicia sesión para usar tus fotos de progreso.</div>
      </section>
    );
  }

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}
      {msg ? <section className="message">{msg}</section> : null}

      <section className="surface privacyNote">
        <strong>Fotos privadas</strong>
        <span className="small">
          Se guardan solo en el almacenamiento privado de la app en este dispositivo. No se suben al servidor, no
          se sincronizan y tu coach no las ve. Si desinstalas la app o borras sus datos, se pierden.
        </span>
        {usageMb !== null ? <span className="small">{`Espacio usado por la app: ${usageMb.toFixed(1)} MB`}</span> : null}
      </section>

      <section className="surface stack compactStack">
        <div className="sectionHead">
          <h3>Nueva foto</h3>
          <p>Misma pose, misma luz y misma distancia hacen comparable el progreso.</p>
        </div>

        <div className="splitGrid">
          <DatePicker label="Fecha" value={takenAt} onChange={setTakenAt} />
          <div>
            <span className="smallLabel">Pose</span>
            <Select
              ariaLabel="Pose"
              value={pose}
              onChange={(v) => setPose(v as ProgressPhotoPose)}
              options={PROGRESS_PHOTO_POSES.map((item) => ({ value: item, label: item }))}
            />
          </div>
          <label>
            <span className="smallLabel">{`Peso (${prefs.weightUnit}, opcional)`}</span>
            <input
              className="input"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              inputMode="decimal"
              placeholder="0.0"
            />
          </label>
        </div>

        <label>
          <span className="smallLabel">Nota</span>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Opcional: fase, semana, sensaciones..."
          />
        </label>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => void handleFile(e.target.files?.[0] || null)}
        />

        <div className="quickActions">
          <button className="btn primary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? "Guardando..." : "Agregar foto"}
          </button>
          {photos.length > 0 ? (
            <button className="btn" onClick={() => void removeAll()} disabled={busy}>
              Borrar todas
            </button>
          ) : null}
        </div>
      </section>

      {comparePair.length === 2 ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Comparación</h3>
            <p>{`${formatTakenAt(comparePair[0].takenAt)} vs ${formatTakenAt(comparePair[1].takenAt)}`}</p>
          </div>
          <div className="photoCompare">
            {comparePair.map((item) => (
              <figure key={item.id} className="photoCompareItem">
                <img src={urls[item.id]} alt={`Progreso ${formatTakenAt(item.takenAt)}`} />
                <figcaption className="small">
                  {`${formatTakenAt(item.takenAt)} | ${item.pose}`}
                  {typeof item.weightKg === "number" ? ` | ${formatWeight(item.weightKg, prefs.weightUnit)}` : ""}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="quickActions" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setCompareIds([])}>
              Limpiar comparación
            </button>
          </div>
        </section>
      ) : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>Mis fotos</h3>
          <p>Toca una foto para verla; marca dos para comparar.</p>
        </div>

        {loading ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Cargando fotos...
          </div>
        ) : photos.length === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aún no hay fotos de progreso.
          </div>
        ) : (
          <div className="photoGrid" style={{ marginTop: 12 }}>
            {photos.map((item) => (
              <article key={item.id} className={`photoCard ${compareIds.includes(item.id) ? "selected" : ""}`}>
                <button className="photoThumbButton" onClick={() => setViewerId(item.id)}>
                  <img src={urls[item.id]} alt={`Progreso ${formatTakenAt(item.takenAt)}`} loading="lazy" />
                </button>
                <div className="photoCardMeta">
                  <strong className="small">{formatTakenAt(item.takenAt)}</strong>
                  <span className="small">
                    {item.pose}
                    {typeof item.weightKg === "number" ? ` | ${formatWeight(item.weightKg, prefs.weightUnit)}` : ""}
                  </span>
                </div>
                <div className="photoCardActions">
                  <button className="btn" onClick={() => toggleCompare(item.id)}>
                    {compareIds.includes(item.id) ? "Quitar" : "Comparar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {viewer ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => setViewerId(null)}>
          <div className="modalCard photoViewer" onClick={(e) => e.stopPropagation()}>
            <img src={urls[viewer.id]} alt={`Progreso ${formatTakenAt(viewer.takenAt)}`} />
            <div className="stack compactStack" style={{ marginTop: 10 }}>
              <strong>{formatTakenAt(viewer.takenAt)}</strong>
              <span className="small">
                {viewer.pose}
                {typeof viewer.weightKg === "number" ? ` | ${formatWeight(viewer.weightKg, prefs.weightUnit)}` : ""}
              </span>
              {viewer.note ? <span className="small">{viewer.note}</span> : null}
              <div className="quickActions">
                <button className="btn" onClick={() => downloadPhoto(viewer)}>
                  Guardar copia
                </button>
                <button className="btn" onClick={() => void removePhoto(viewer.id)} disabled={busy}>
                  Borrar
                </button>
                <button className="btn primary" onClick={() => setViewerId(null)}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
