import { loadJSON, saveJSON } from "./storage";

const PROFILE_AVATAR_STORAGE_KEY = "coach_ai_profile_avatar_v1";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

type ProfileAvatarStore = Record<string, string>;

export const DEFAULT_PROFILE_AVATAR_URL = "/profile-default.svg";
export const PROFILE_AVATAR_CHANGED_EVENT = "coach_ai_profile_avatar_changed";

function normalizeUserId(userId: string | null | undefined): string {
  return (userId || "").trim();
}

function readStore(): ProfileAvatarStore {
  return loadJSON<ProfileAvatarStore>(PROFILE_AVATAR_STORAGE_KEY, {});
}

function writeStore(store: ProfileAvatarStore): void {
  saveJSON(PROFILE_AVATAR_STORAGE_KEY, store);
}

function dispatchAvatarChanged(userId: string, avatarUrl: string | null): void {
  window.dispatchEvent(
    new CustomEvent(PROFILE_AVATAR_CHANGED_EVENT, {
      detail: { userId, avatarUrl },
    }),
  );
}

export function loadProfileAvatarUrl(userId: string | null | undefined): string | null {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  const store = readStore();
  return store[normalizedUserId] || null;
}

export function saveProfileAvatarUrl(userId: string, avatarUrl: string): void {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;
  const cleanedAvatarUrl = avatarUrl.trim();
  if (!cleanedAvatarUrl) return;
  const store = readStore();
  store[normalizedUserId] = cleanedAvatarUrl;
  writeStore(store);
  dispatchAvatarChanged(normalizedUserId, cleanedAvatarUrl);
}

export function clearProfileAvatarUrl(userId: string): void {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;
  const store = readStore();
  if (!(normalizedUserId in store)) return;
  delete store[normalizedUserId];
  writeStore(store);
  dispatchAvatarChanged(normalizedUserId, null);
}

export function readProfileAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const isImage = file.type.startsWith("image/");
    if (!isImage) {
      reject(new Error("Selecciona una imagen valida."));
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      reject(new Error("La imagen supera 2 MB. Usa un archivo mas liviano."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/")) {
        reject(new Error("Formato de imagen no soportado."));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}
