import { describe, expect, it } from "vitest";
import { asPct, kg, round1, signedKg } from "./format";
import { formatDate, formatDateDayMonth, formatDateMedium } from "./locale";
import { formatExerciseNameForList } from "./exerciseTree";

describe("format", () => {
  it("round1 redondea a un decimal", () => {
    expect(round1(1.26)).toBe(1.3);
    expect(round1(2)).toBe(2);
  });
  it("asPct agrega signo solo en positivos", () => {
    expect(asPct(0.123)).toBe("+12.3%");
    expect(asPct(-0.05)).toBe("-5%");
    expect(asPct(0)).toBe("0%");
  });
  it("kg y signedKg", () => {
    expect(kg(82.46)).toBe("82.5 kg");
    expect(signedKg(2.04)).toBe("+2 kg");
    expect(signedKg(-1.5)).toBe("-1.5 kg");
    expect(signedKg(null)).toBe("-");
  });
});

describe("locale con fallback", () => {
  it("devuelve el fallback si la fecha no es válida", () => {
    expect(formatDate(null, "-")).toBe("-");
    expect(formatDate("xx", "-")).toBe("-");
    expect(formatDate("xx")).toBe("");
    expect(formatDateMedium("xx", "-")).toBe("-");
    expect(formatDateDayMonth("xx", "-")).toBe("-");
  });
  it("mantiene el formato de las copias locales", () => {
    const iso = "2026-09-17T12:00:00";
    expect(formatDateMedium(iso)).toBe(
      new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }),
    );
    expect(formatDateDayMonth(iso)).toBe(
      new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short" }),
    );
  });
});

describe("nombre de ejercicio", () => {
  it("cambia > por -", () => {
    expect(formatExerciseNameForList(" Pecho > Press ")).toBe("Pecho - Press");
  });
});
