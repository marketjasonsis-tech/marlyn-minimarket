import { describe, expect, it } from "vitest";
import {
  formatearPrecio,
  limpiarTipeoPrecio,
  textoEdicionDesdeValorCrudo,
  valorCrudoDesdeTipeo,
} from "./formatoPrecio";

describe("formatearPrecio", () => {
  it("mil pesos queda con el punto de miles", () => {
    expect(formatearPrecio("1000")).toBe("1.000");
  });

  it("diez mil pesos también", () => {
    expect(formatearPrecio("10000")).toBe("10.000");
  });

  it("menos de mil no lleva punto", () => {
    expect(formatearPrecio("850")).toBe("850");
  });

  it("con centavos usa coma decimal", () => {
    expect(formatearPrecio("1500.5")).toBe("1.500,5");
  });

  it("vacío queda vacío", () => {
    expect(formatearPrecio("")).toBe("");
  });

  it("un valor no numérico no rompe, devuelve vacío", () => {
    expect(formatearPrecio("abc")).toBe("");
  });
});

describe("limpiarTipeoPrecio", () => {
  it("deja pasar solo dígitos", () => {
    expect(limpiarTipeoPrecio("1000")).toBe("1000");
  });

  it("saca cualquier cosa que no sea dígito o coma", () => {
    expect(limpiarTipeoPrecio("1.500 pesos")).toBe("1500");
  });

  it("un punto de miles pegado (por ejemplo, al copiar y pegar) se descarta", () => {
    expect(limpiarTipeoPrecio("1.500,50")).toBe("1500,50");
  });

  it("permite una sola coma decimal", () => {
    expect(limpiarTipeoPrecio("1500,5")).toBe("1500,5");
  });

  it("una segunda coma se ignora, no corta el tipeo", () => {
    expect(limpiarTipeoPrecio("1500,5,5")).toBe("1500,55");
  });
});

describe("valorCrudoDesdeTipeo", () => {
  it("cambia la coma decimal por punto, que es lo que espera el resto del formulario", () => {
    expect(valorCrudoDesdeTipeo("1500,5")).toBe("1500.5");
  });

  it("sin coma queda igual", () => {
    expect(valorCrudoDesdeTipeo("1500")).toBe("1500");
  });
});

describe("textoEdicionDesdeValorCrudo", () => {
  it("cambia el punto decimal por coma, que es lo que se tipea en el campo", () => {
    expect(textoEdicionDesdeValorCrudo("1500.5")).toBe("1500,5");
  });

  it("sin decimales queda igual", () => {
    expect(textoEdicionDesdeValorCrudo("1500")).toBe("1500");
  });

  it("es la vuelta de valorCrudoDesdeTipeo", () => {
    expect(valorCrudoDesdeTipeo(textoEdicionDesdeValorCrudo("11102.44"))).toBe("11102.44");
  });
});
