import { describe, expect, it } from "vitest";
import type { Producto } from "../tipos";
import { datosNoComprar, limpiarMotivo, productosNoComprar } from "./noComprar";

function producto(datos: Partial<Producto>): Producto {
  return {
    id: "p1",
    nombre: "Producto",
    categoriaId: null,
    proveedorId: null,
    codigoBarras: null,
    codigosAdicionales: [],
    precioCosto: 10,
    precioVenta: 20,
    incluyeIva: false,
    porcentajeGanancia: null,
    stockActual: 0,
    stockMinimo: 0,
    unidad: "unidad",
    activo: true,
    noComprar: false,
    noComprarMotivo: null,
    noComprarDesde: null,
    ...datos,
  };
}

describe("limpiarMotivo", () => {
  it("un motivo de solo espacios se guarda como null", () => {
    expect(limpiarMotivo("   ")).toBeNull();
    expect(limpiarMotivo("")).toBeNull();
  });

  it("recorta los espacios de los costados", () => {
    expect(limpiarMotivo("  se vence rápido ")).toBe("se vence rápido");
  });
});

describe("datosNoComprar", () => {
  const ahora = new Date("2026-09-29T15:00:00.000Z");

  it("al marcar guarda motivo limpio y la fecha de ahora", () => {
    expect(datosNoComprar(true, " mala calidad ", null, ahora)).toEqual({
      no_comprar: true,
      no_comprar_motivo: "mala calidad",
      no_comprar_desde: "2026-09-29T15:00:00.000Z",
    });
  });

  it("si ya estaba marcado, conserva la fecha original al editar el motivo", () => {
    const datos = datosNoComprar(true, "otro motivo", "2026-01-10T12:00:00.000Z", ahora);
    expect(datos.no_comprar_desde).toBe("2026-01-10T12:00:00.000Z");
    expect(datos.no_comprar_motivo).toBe("otro motivo");
  });

  it("al desmarcar limpia motivo y fecha (lo exige el check de la base)", () => {
    expect(datosNoComprar(false, "lo que sea", "2026-01-10T12:00:00.000Z", ahora)).toEqual({
      no_comprar: false,
      no_comprar_motivo: null,
      no_comprar_desde: null,
    });
  });
});

describe("productosNoComprar", () => {
  it("lista solo los marcados y activos, ordenados por nombre", () => {
    const lista = productosNoComprar([
      producto({ id: "1", nombre: "Zeta", noComprar: true }),
      producto({ id: "2", nombre: "Alfa", noComprar: true }),
      producto({ id: "3", nombre: "Normal", noComprar: false }),
      producto({ id: "4", nombre: "Eliminado", noComprar: true, activo: false }),
    ]);
    expect(lista.map((p) => p.nombre)).toEqual(["Alfa", "Zeta"]);
  });
});
