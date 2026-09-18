import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `mealOutbox.ts` (via `../sessionOutbox`) importa `ApiError`/`ingestSessions`
// y `createDietEntry` de `../../api`. Se mockea aqui para controlar exito/
// fallo de red sin tocar la red real. Ambos modulos resuelven al MISMO
// archivo (`src/api.ts`), asi que un solo mock cubre las dos importaciones.
const { createDietEntryMock } = vi.hoisted(() => ({ createDietEntryMock: vi.fn() }));

vi.mock("../../api", () => {
  class ApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  }
  return {
    ApiError,
    ingestSessions: vi.fn(),
    createDietEntry: createDietEntryMock,
  };
});

import { ApiError } from "../../api";
import {
  MEAL_OUTBOX_CHANGED_EVENT,
  enqueueMealEntry,
  flushMealOutbox,
  installMealOutboxAutoFlush,
  mealOutboxCount,
} from "./mealOutbox";

const OUTBOX_KEY = "coach_ai_meal_outbox_v1";

// Node (entorno de vitest por defecto en este repo, sin jsdom) no trae
// window/document/localStorage: se stubbean con dobles minimos, suficientes
// para lo que mealOutbox.ts toca (localStorage, dispatchEvent, addEventListener).
function makeLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

let localStorageStub: ReturnType<typeof makeLocalStorageStub>;
let windowStub: EventTarget;
let documentStub: EventTarget & { visibilityState: string };
let navigatorStub: { onLine: boolean };

function readStoredEntries(): Array<{ payload: { client_ref?: string | null } }> {
  const raw = localStorageStub.getItem(OUTBOX_KEY);
  return raw ? (JSON.parse(raw) as Array<{ payload: { client_ref?: string | null } }>) : [];
}

beforeEach(() => {
  localStorageStub = makeLocalStorageStub();
  windowStub = new EventTarget();
  documentStub = Object.assign(new EventTarget(), { visibilityState: "visible" });
  navigatorStub = { onLine: true };

  vi.stubGlobal("localStorage", localStorageStub);
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("navigator", navigatorStub);

  createDietEntryMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("enqueueMealEntry", () => {
  it("agrega una comida a la cola y avisa por evento", () => {
    const listener = vi.fn();
    windowStub.addEventListener(MEAL_OUTBOX_CHANGED_EVENT, listener);

    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "almuerzo", quantity_g: 100 });

    expect(mealOutboxCount()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("genera el client_ref al encolar, no lo deja vacio", () => {
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "snack", quantity_g: 30 });

    const [entry] = readStoredEntries();
    expect(entry.payload.client_ref).toBeTruthy();
  });

  it("cada comida encolada recibe un client_ref distinto", () => {
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "desayuno", quantity_g: 50 });
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "cena", quantity_g: 60 });

    const [first, second] = readStoredEntries();
    expect(first.payload.client_ref).not.toBe(second.payload.client_ref);
  });
});

describe("flushMealOutbox — exito", () => {
  it("sube lo encolado, vacia la cola y manda el client_ref generado al encolar", async () => {
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "cena", quantity_g: 150, food_name: "Pollo" });
    const [{ payload: queued }] = readStoredEntries();
    createDietEntryMock.mockResolvedValueOnce({ id: "entry-1" });

    const result = await flushMealOutbox();

    expect(result).toEqual({ uploaded: 1, remaining: 0 });
    expect(mealOutboxCount()).toBe(0);
    expect(createDietEntryMock).toHaveBeenCalledTimes(1);
    expect(createDietEntryMock.mock.calls[0][0]).toMatchObject({
      athlete_id: "athlete_1",
      food_name: "Pollo",
      client_ref: queued.client_ref,
    });
  });

  it("con la cola vacia no llama al backend", async () => {
    const result = await flushMealOutbox();

    expect(result).toEqual({ uploaded: 0, remaining: 0 });
    expect(createDietEntryMock).not.toHaveBeenCalled();
  });
});

describe("flushMealOutbox — fallo de red", () => {
  it("conserva la cola completa (no se pierde ni se da por subida)", async () => {
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "desayuno", quantity_g: 80 });
    createDietEntryMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await flushMealOutbox();

    expect(result.uploaded).toBe(0);
    expect(result.remaining).toBe(1);
    expect(mealOutboxCount()).toBe(1);
  });

  it("un timeout tras un commit exitoso del servidor no duplica: el reintento reenvia el MISMO client_ref", async () => {
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "almuerzo", quantity_g: 100, food_name: "Arroz" });
    const [{ payload: queued }] = readStoredEntries();

    // Primer intento: el servidor pudo haber comiteado, pero el cliente ve timeout.
    createDietEntryMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await flushMealOutbox();

    const [{ payload: afterFailedAttempt }] = readStoredEntries();
    expect(afterFailedAttempt.client_ref).toBe(queued.client_ref);

    // Reintento tras reconectar: mismo client_ref, el backend lo dedupe.
    createDietEntryMock.mockResolvedValueOnce({ id: "entry-1" });
    const result = await flushMealOutbox();

    expect(result).toEqual({ uploaded: 1, remaining: 0 });
    expect(createDietEntryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ client_ref: queued.client_ref }),
    );
  });

  it("un error del servidor (ApiError) NO se trata como fallo de red: no bloquea el resto de la cola", async () => {
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "snack", quantity_g: 20 });
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "cena", quantity_g: 90 });
    createDietEntryMock
      .mockRejectedValueOnce(new ApiError(400, "invalid payload"))
      .mockResolvedValueOnce({ id: "entry-2" });

    const result = await flushMealOutbox();

    // La primera queda en la cola (error de servidor, no de red); la segunda sube.
    expect(result.uploaded).toBe(1);
    expect(result.remaining).toBe(1);
    expect(mealOutboxCount()).toBe(1);
  });

  it("401 (sesion vencida) detiene el flush sin gastar intentos: nada se descarta", async () => {
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "snack", quantity_g: 20 });
    enqueueMealEntry({ athlete_id: "athlete_1", meal_slot: "cena", quantity_g: 90 });
    createDietEntryMock.mockRejectedValue(new ApiError(401, "Invalid token."));

    const result = await flushMealOutbox();

    expect(result).toEqual({ uploaded: 0, remaining: 2 });
    expect(createDietEntryMock).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(localStorageStub.getItem(OUTBOX_KEY) ?? "[]") as Array<{ attempts: number }>;
    expect(stored.every((entry) => entry.attempts === 0)).toBe(true);
  });
});

describe("installMealOutboxAutoFlush", () => {
  it("es idempotente: llamarlo varias veces no rompe nada", () => {
    expect(() => {
      installMealOutboxAutoFlush();
      installMealOutboxAutoFlush();
    }).not.toThrow();
  });
});
