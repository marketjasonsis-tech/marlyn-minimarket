import { describe, expect, it } from "vitest";
import { estadoDeCarga } from "./estadoDeCarga";

describe("estadoDeCarga", () => {
  it("sin resultado ni error para la clave actual, está cargando", () => {
    expect(estadoDeCarga("A", null, null)).toEqual({ listo: false, error: false, cargando: true });
    expect(estadoDeCarga("B", "A", null)).toEqual({ listo: false, error: false, cargando: true });
  });

  it("con resultado de la clave actual, está listo", () => {
    expect(estadoDeCarga("A", "A", null)).toEqual({ listo: true, error: false, cargando: false });
  });

  it("si la clave actual falló y no hay resultado para ella, hay error", () => {
    expect(estadoDeCarga("A", "B", "A")).toEqual({ listo: false, error: true, cargando: false });
  });

  it("un error viejo no pisa un resultado ya exitoso de la misma clave", () => {
    // Falló A, el usuario fue a B y volvió a A, y esa vez salió bien.
    expect(estadoDeCarga("A", "A", "A")).toEqual({ listo: true, error: false, cargando: false });
  });
});
