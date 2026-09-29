import { describe, expect, it } from "vitest";
import { etiquetaCantidadItem, tamañoTextoItem } from "./formato";

describe("tamañoTextoItem", () => {
  it("un nombre corto usa el tamaño grande de siempre", () => {
    expect(tamañoTextoItem("Coca Cola 2L")).toBe("text-2xl");
  });

  it("caso real del cliente: un nombre largo achica de tamaño", () => {
    expect(tamañoTextoItem("CABALLA AL NATURAL /EN ACEITE Y EN AGUA CARACAS 380GR")).not.toBe("text-2xl");
  });

  it("es monótono: un nombre más largo nunca da una clase más grande", () => {
    const orden = ["text-base", "text-lg", "text-xl", "text-2xl"];
    const corto = orden.indexOf(tamañoTextoItem("Yerba"));
    const largo = orden.indexOf(tamañoTextoItem("Pasta de maní con chips de chocolate blanco y almendras 900g"));
    expect(largo).toBeLessThanOrEqual(corto);
  });
});

describe("etiquetaCantidadItem", () => {
  it("un producto por unidad muestra la cantidad antes del nombre", () => {
    expect(etiquetaCantidadItem({ cantidad: 3 })).toBe("3 ×");
    expect(etiquetaCantidadItem({ cantidad: 1, porPeso: false })).toBe("1 ×");
  });

  it("un producto por peso no muestra cantidad: solo el nombre y el precio", () => {
    // Caso real del cliente: no querían "0.08333 × JAMON LARIO" en la TV.
    expect(etiquetaCantidadItem({ cantidad: 0.08333, porPeso: true })).toBeNull();
  });
});
