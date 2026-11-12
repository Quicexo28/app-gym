import { describe, expect, it } from "vitest";

import type { SessionRecord } from "../api";
import {
  aggregateSetsByBodyGroup,
  BODY_SLUGS,
  bodyOpacity,
  MAX_OPACITY,
  MIN_OPACITY,
  normalizeBodyValue,
  toBodySlug,
} from "./bodyMap";

function session(start: string, exercises: Array<[string, number]>): SessionRecord {
  return {
    athlete_id: "a",
    start_time: start,
    duration_min: 60,
    rpe: 7,
    exercises: exercises.map(([name, n]) => ({
      name,
      sets: Array.from({ length: n }, () => ({ reps: 8, load_kg: 50 })),
    })),
  };
}

describe("toBodySlug", () => {
  it("normaliza alias, tildes y plurales a los 12 slugs", () => {
    expect(toBodySlug("Hombros")).toBe("hombro");
    expect(toBodySlug("Bíceps")).toBe("bicep");
    expect(toBodySlug("Glúteos")).toBe("gluteo");
    expect(toBodySlug("Cuádriceps")).toBe("cuadricep");
    expect(toBodySlug("Gemelos")).toBe("pantorrilla");
    expect(toBodySlug("Isquiotibiales")).toBe("femoral");
    expect(toBodySlug("Trapecio")).toBe("espalda");
    expect(toBodySlug("core")).toBe("abdomen");
  });

  it("devuelve null para grupos desconocidos o vacios", () => {
    expect(toBodySlug("General")).toBeNull();
    expect(toBodySlug("")).toBeNull();
    expect(toBodySlug(undefined)).toBeNull();
  });

  it("cada slug se resuelve a si mismo", () => {
    for (const slug of BODY_SLUGS) expect(toBodySlug(slug)).toBe(slug);
  });
});

describe("opacidad", () => {
  it("normaliza contra el maximo y acota", () => {
    expect(normalizeBodyValue(5, 10)).toBe(0.5);
    expect(normalizeBodyValue(20, 10)).toBe(1);
    expect(normalizeBodyValue(0, 10)).toBe(0);
    expect(normalizeBodyValue(3, 0)).toBe(0);
    expect(normalizeBodyValue(Number.NaN, 10)).toBe(0);
  });

  it("es monotona, sin datos = minima y maximo = tope", () => {
    expect(bodyOpacity(0)).toBe(MIN_OPACITY);
    expect(bodyOpacity(1)).toBeCloseTo(MAX_OPACITY);
    expect(bodyOpacity(0.01)).toBeGreaterThan(MIN_OPACITY);
    expect(bodyOpacity(0.2)).toBeLessThan(bodyOpacity(0.6));
    expect(bodyOpacity(5)).toBeCloseTo(MAX_OPACITY);
  });
});

describe("aggregateSetsByBodyGroup", () => {
  const catalog = [
    { name: "Press banca", group: "Pecho" },
    { name: "Sentadilla - Libre", group: "Cuadriceps" },
    { name: "Rareza", group: "General" },
  ];
  const now = new Date("2026-11-10T12:00:00Z");

  it("suma series por slug y deja en 0 los grupos sin datos", () => {
    const out = aggregateSetsByBodyGroup(
      [session("2026-11-08T10:00:00Z", [["press  banca", 4], ["Sentadilla - Libre", 3], ["Rareza", 2], ["Desconocido", 1]])],
      catalog,
      null,
      now,
    );
    expect(out.sets.pecho).toBe(4);
    expect(out.sets.cuadricep).toBe(3);
    expect(out.sets.espalda).toBe(0);
    expect(out.unclassifiedSets).toBe(3);
  });

  it("respeta el periodo", () => {
    const sessions = [
      session("2026-11-08T10:00:00Z", [["Press banca", 2]]),
      session("2026-08-01T10:00:00Z", [["Press banca", 5]]),
    ];
    expect(aggregateSetsByBodyGroup(sessions, catalog, 28, now).sets.pecho).toBe(2);
    expect(aggregateSetsByBodyGroup(sessions, catalog, null, now).sets.pecho).toBe(7);
  });
});
