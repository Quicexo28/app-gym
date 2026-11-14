import { describe, expect, it } from "vitest";

import { asUnilateralEntry, baseExerciseName, isUnilateralName, setSides, setUnilateralName, withUnilateralName } from "./laterality";

describe("laterality", () => {
  it("detecta nombres unilaterales en ambos formatos", () => {
    expect(isUnilateralName("Prensa de Piernas - En Máquina - Unilateral")).toBe(true);
    expect(isUnilateralName("Curl Femoral - En Máquina - Sentado Unilateral")).toBe(true);
    expect(isUnilateralName("Curl Femoral - En Máquina - Sentado")).toBe(false);
  });

  it("quita el sufijo para volver al nombre del catálogo", () => {
    expect(baseExerciseName("Prensa de Piernas - En Máquina - Unilateral")).toBe("Prensa de Piernas - En Máquina");
    expect(baseExerciseName("Curl Femoral - En Máquina - Sentado Unilateral")).toBe("Curl Femoral - En Máquina - Sentado");
    expect(baseExerciseName("Sentadilla - En Smith")).toBe("Sentadilla - En Smith");
  });

  it("arma el nombre unilateral con el formato histórico y no lo duplica", () => {
    expect(withUnilateralName("Prensa de Piernas - En Máquina", false)).toBe("Prensa de Piernas - En Máquina - Unilateral");
    expect(withUnilateralName("Curl Femoral - En Máquina - Sentado", true)).toBe("Curl Femoral - En Máquina - Sentado Unilateral");
    expect(withUnilateralName("Prensa de Piernas - En Máquina - Unilateral", false)).toBe("Prensa de Piernas - En Máquina - Unilateral");
  });

  it("conserva el resto de la entrada", () => {
    const entry = { name: "Extensión de Cuádriceps - En Máquina", subvariation: "", group: "Cuádriceps" };
    expect(asUnilateralEntry(entry)).toEqual({ ...entry, name: "Extensión de Cuádriceps - En Máquina - Unilateral" });
  });

  it("activa y quita unilateral sobre un nombre guardado", () => {
    expect(setUnilateralName("Prensa de Piernas - En Máquina", true)).toBe("Prensa de Piernas - En Máquina - Unilateral");
    expect(setUnilateralName("Curl Femoral - En Máquina - Sentado", true)).toBe("Curl Femoral - En Máquina - Sentado Unilateral");
    expect(setUnilateralName("Curl Femoral - En Máquina - Sentado Unilateral", false)).toBe("Curl Femoral - En Máquina - Sentado");
    expect(setUnilateralName("Prensa de Piernas - En Máquina - Unilateral", true)).toBe("Prensa de Piernas - En Máquina - Unilateral");
  });

  it("sin lados guardados, ambos siguen a completed", () => {
    expect(setSides({ completed: true })).toEqual({ left: true, right: true });
    expect(setSides({ completed: false, sides: { left: true, right: false } })).toEqual({ left: true, right: false });
  });
});
