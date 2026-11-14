import { describe, expect, it } from "vitest";

import { extrasFromRoles, rolesFromExtras } from "./muscleRoles";

describe("muscleRoles", () => {
  it("convierte pesos en papeles", () => {
    expect(rolesFromExtras([{ group: "Tríceps", weight: 0.5 }, { group: "Hombros", weight: 1 }])).toEqual({
      tricep: "secondary",
      hombro: "main",
    });
  });

  it("no repite el grupo principal del ejercicio", () => {
    expect(extrasFromRoles({ pecho: "main", tricep: "secondary" }, "Pecho")).toEqual([{ group: "Tríceps", weight: 0.5 }]);
  });

  it("conserva extras que no mapean a un grupo del cuerpo", () => {
    const original = [{ group: "Agarre", weight: 0.3 }];
    expect(extrasFromRoles({ bicep: "main" }, "Espalda", original)).toEqual([
      { group: "Bíceps", weight: 1 },
      { group: "Agarre", weight: 0.3 },
    ]);
  });

  it("ida y vuelta mantiene los papeles", () => {
    const extras = extrasFromRoles({ gluteo: "main", femoral: "secondary" }, "Cuádriceps");
    expect(rolesFromExtras(extras)).toEqual({ gluteo: "main", femoral: "secondary" });
  });
});
