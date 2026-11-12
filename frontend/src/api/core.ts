export type JsonObject = Record<string, unknown>;

export type Role = "user" | "coach" | "admin";

export type BackendPlan = "free" | "pro" | "coach";

export type PlanLabel = "standard" | "plus" | "coach";

export type ViewScopes = { admin: boolean; coach: boolean };

const PLAN_LABEL_BY_BACKEND: Record<BackendPlan, PlanLabel> = {
  free: "standard",
  pro: "plus",
  coach: "coach",
};

const BACKEND_PLAN_BY_LABEL: Record<PlanLabel, BackendPlan> = {
  standard: "free",
  plus: "pro",
  coach: "coach",
};

export function backendPlanToLabel(plan: BackendPlan): PlanLabel {
  return PLAN_LABEL_BY_BACKEND[plan];
}

export function labelToBackendPlan(label: PlanLabel): BackendPlan {
  return BACKEND_PLAN_BY_LABEL[label];
}

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

let authToken: string | null = null;

let apiViewScopes: ViewScopes = { admin: false, coach: false };

let onUnauthorized: (() => void) | null = null;

const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "").replace(/\/+$/, "");

export function toApiUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function setApiToken(token: string | null): void {
  authToken = token;
}

export function setApiViewScopes(scopes: ViewScopes): void {
  apiViewScopes = scopes;
}

/**
 * Aviso global de token rechazado. El access token vive 24h y no hay refresh:
 * sin esto la sesión vencida se queda montada y cada pantalla muestra el
 * "Invalid token." crudo del backend en vez de mandar al login.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Agrega token y vista activa (admin/coach) a las cabeceras de toda llamada a la API. */
export function applyAuthHeaders(headers: Headers): void {
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  headers.set("X-App-Admin-View", apiViewScopes.admin ? "1" : "0");
  headers.set("X-App-Coach-View", apiViewScopes.coach ? "1" : "0");
}

/** Solo cuenta como sesión vencida si mandamos token y el endpoint no es el de autenticacion. */
export function notifyUnauthorized(status: number, path: string): void {
  if (status !== 401 || !authToken) return;
  if (path.startsWith("/api/v1/auth/")) return;
  onUnauthorized?.();
}

export async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body !== undefined && !isFormDataBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // multipart (subida de fotos): NO se fija Content-Type a mano, el navegador
  // le agrega el boundary automaticamente cuando el body es un FormData.
  applyAuthHeaders(headers);

  const res = await fetch(toApiUrl(path), {
    ...init,
    headers,
  });

  if (!res.ok) {
    const raw = await res.text();
    let detail = raw.trim();

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { detail?: unknown };
        if (typeof parsed.detail === "string" && parsed.detail.trim()) {
          detail = parsed.detail.trim();
        } else if (
          parsed.detail &&
          typeof parsed.detail === "object" &&
          "message" in parsed.detail &&
          typeof (parsed.detail as { message?: unknown }).message === "string"
        ) {
          detail = String((parsed.detail as { message: string }).message).trim();
        }
      } catch {
        // Keep raw text fallback.
      }
    }

    if (!detail) {
      detail = `${res.status} ${res.statusText}`;
    }
    notifyUnauthorized(res.status, path);
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as T;
}
