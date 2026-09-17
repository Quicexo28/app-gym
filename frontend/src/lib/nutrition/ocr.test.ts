import { describe, expect, it } from "vitest";

import { MlKitOcrProvider, selectOcrProvider } from "./ocr";

describe("selectOcrProvider", () => {
  it("devuelve MlKitOcrProvider en nativo", () => {
    const provider = selectOcrProvider({ isNative: true });
    expect(provider).toBeInstanceOf(MlKitOcrProvider);
  });

  it("devuelve null en web: sin proveedor, la UI cae al formulario manual", () => {
    expect(selectOcrProvider({ isNative: false })).toBeNull();
  });
});

describe("MlKitOcrProvider.recognize", () => {
  it("rechaza si no se le da una ruta de archivo local", async () => {
    const provider = new MlKitOcrProvider();
    await expect(provider.recognize({})).rejects.toThrow(/path/);
  });

  it("rechaza si solo se le da un blob (proveedor on-device exige path)", async () => {
    const provider = new MlKitOcrProvider();
    await expect(provider.recognize({ blob: new Blob(["x"]) })).rejects.toThrow(/path/);
  });
});
