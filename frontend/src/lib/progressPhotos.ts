/**
 * Fotos de progreso fisico: almacenamiento LOCAL y PRIVADO.
 *
 * Regla del modulo: los blobs nunca salen del dispositivo. No hay fetch, no hay
 * endpoint, no hay sync. Viven en IndexedDB, que en la app Android (Capacitor)
 * queda dentro del almacenamiento privado del paquete y en web queda atado al
 * origen. Cualquier cambio que agregue red aquí rompe la garantia de privacidad.
 */

const DB_NAME = "alzo_progress_photos";
const DB_VERSION = 1;
const STORE = "photos";
const INDEX_OWNER_TAKEN = "owner_takenAt";

export const PROGRESS_PHOTO_POSES = ["frente", "lado", "espalda", "libre"] as const;
export type ProgressPhotoPose = (typeof PROGRESS_PHOTO_POSES)[number];

export type ProgressPhotoRecord = {
  id: string;
  ownerId: string;
  takenAt: string;
  pose: ProgressPhotoPose;
  note?: string;
  weightKg?: number;
  blob: Blob;
  width: number;
  height: number;
  createdAt: string;
};

export type ProgressPhotoMeta = Omit<ProgressPhotoRecord, "blob">;

const MAX_EDGE_PX = 1440;
const JPEG_QUALITY = 0.82;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(INDEX_OWNER_TAKEN, ["ownerId", "takenAt"], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTx<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ph_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function stripBlob(record: ProgressPhotoRecord): ProgressPhotoMeta {
  return {
    id: record.id,
    ownerId: record.ownerId,
    takenAt: record.takenAt,
    pose: record.pose,
    note: record.note,
    weightKg: record.weightKg,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
  };
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };
    img.src = url;
  });
}

/** Reescala a JPEG con borde máximo MAX_EDGE_PX para no reventar la cuota local. */
async function compress(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { blob: file, width: img.width, height: img.height };
  }
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", JPEG_QUALITY);
  });

  return { blob: blob || file, width, height };
}

export async function addProgressPhoto(params: {
  ownerId: string;
  file: Blob;
  takenAt: string;
  pose: ProgressPhotoPose;
  note?: string;
  weightKg?: number;
}): Promise<ProgressPhotoMeta> {
  const { blob, width, height } = await compress(params.file);
  const record: ProgressPhotoRecord = {
    id: uid(),
    ownerId: params.ownerId,
    takenAt: params.takenAt,
    pose: params.pose,
    note: params.note?.trim() || undefined,
    weightKg: Number.isFinite(params.weightKg) ? params.weightKg : undefined,
    blob,
    width,
    height,
    createdAt: new Date().toISOString(),
  };

  await runTx("readwrite", (store) => store.put(record));
  return stripBlob(record);
}

/** Metadatos (sin blobs) del propietario, más reciente primero. */
export async function listProgressPhotos(ownerId: string): Promise<ProgressPhotoMeta[]> {
  const rows = await runTx<ProgressPhotoRecord[]>("readonly", (store) => store.getAll());
  return rows
    .filter((row) => row.ownerId === ownerId)
    .map(stripBlob)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export async function getProgressPhotoBlob(id: string, ownerId: string): Promise<Blob | null> {
  const row = await runTx<ProgressPhotoRecord | undefined>("readonly", (store) => store.get(id));
  if (!row || row.ownerId !== ownerId) return null;
  return row.blob;
}

export async function deleteProgressPhoto(id: string, ownerId: string): Promise<void> {
  const row = await runTx<ProgressPhotoRecord | undefined>("readonly", (store) => store.get(id));
  if (!row || row.ownerId !== ownerId) return;
  await runTx("readwrite", (store) => store.delete(id));
}

export async function deleteAllProgressPhotos(ownerId: string): Promise<number> {
  const rows = await runTx<ProgressPhotoRecord[]>("readonly", (store) => store.getAll());
  const mine = rows.filter((row) => row.ownerId === ownerId);
  for (const row of mine) {
    await runTx("readwrite", (store) => store.delete(row.id));
  }
  return mine.length;
}

/**
 * Pide almacenamiento persistente para que el sistema no borre las fotos al
 * liberar espacio. Silencioso si el navegador no lo soporta.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function estimateStorageUsageMb(): Promise<number | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage } = await navigator.storage.estimate();
    if (typeof usage !== "number") return null;
    return usage / (1024 * 1024);
  } catch {
    return null;
  }
}
