import { describe, expect, it } from "vitest";
import { indiceItemAMostrar } from "./desplazamiento";

const leche = { productoId: "leche", cantidad: 1 };
const pan = { productoId: "pan", cantidad: 2 };
const yerba = { productoId: "yerba", cantidad: 1 };

describe("indiceItemAMostrar", () => {
  it("un producto recién escaneado va al final: se muestra ese", () => {
    expect(indiceItemAMostrar([leche, pan], [leche, pan, yerba])).toBe(2);
  });

  it("volver a escanear uno que ya estaba cargado muestra esa fila, no el final", () => {
    expect(indiceItemAMostrar([leche, pan, yerba], [{ ...leche, cantidad: 2 }, pan, yerba])).toBe(0);
  });

  it("la primera transmisión de un carrito ya armado muestra el último producto", () => {
    // Caso real: la TV se recarga (o se cambia de pestaña en Ventas) con
    // la venta por la mitad.
    expect(indiceItemAMostrar([], [leche, pan, yerba])).toBe(2);
  });

  it("sacar un producto no mueve la lista", () => {
    expect(indiceItemAMostrar([leche, pan, yerba], [leche, yerba])).toBeNull();
  });

  it("una retransmisión sin cambios no mueve la lista", () => {
    expect(indiceItemAMostrar([leche, pan], [leche, pan])).toBeNull();
  });
});
