import { describe, expect, it } from "vitest";
import type { Producto } from "@/modulos/stock/tipos";
import type { Promocion } from "../tipos";
import { descripcionPromocion, promocionesDeProducto } from "./descripcionPromocion";

// Intl.NumberFormat("es-AR", ...) separa "$" del número con un espacio
// NBSP (U+00A0), no un espacio común — construir la moneda esperada con
// el mismo formateador evita comparar un espacio distinto al que
// realmente devuelve platita.format() adentro de descripcionPromocion().
const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

function producto(id: string, nombre: string): Producto {
  return {
    id,
    nombre,
    categoriaId: null,
    proveedorId: null,
    codigoBarras: null,
    codigosAdicionales: [],
    precioCosto: null,
    precioVenta: 0,
    incluyeIva: false,
    porcentajeGanancia: null,
    stockActual: 100,
    stockMinimo: 0,
    unidad: "unidad",
    activo: true,
    noComprar: false,
    noComprarMotivo: null,
    noComprarDesde: null,
  };
}

const PRODUCTOS = [producto("alka", "Alka"), producto("fernet", "Fernet"), producto("coca", "Coca")];

const PROMO_CANTIDAD: Promocion = {
  id: "p1",
  nombre: "3 Alka x 100",
  tipo: "cantidad",
  precioPromocional: 100,
  activa: true,
  items: [{ productoId: "alka", cantidad: 3 }],
};

const PROMO_COMBO: Promocion = {
  id: "p2",
  nombre: "Fernet + Coca",
  tipo: "combo",
  precioPromocional: 19000,
  activa: true,
  items: [
    { productoId: "fernet", cantidad: 1 },
    { productoId: "coca", cantidad: 1 },
  ],
};

describe("descripcionPromocion", () => {
  it("describe una promo por cantidad con el nombre real del producto", () => {
    expect(descripcionPromocion(PROMO_CANTIDAD, PRODUCTOS)).toBe(`Llevando 3 de Alka, sale ${platita.format(100)}`);
  });

  it("describe un combo listando los productos involucrados", () => {
    expect(descripcionPromocion(PROMO_COMBO, PRODUCTOS)).toBe(`Fernet + Coca a ${platita.format(19000)}`);
  });

  it("antepone la cantidad en un combo que pide más de 1 de un producto", () => {
    const combo: Promocion = {
      ...PROMO_COMBO,
      items: [
        { productoId: "coca", cantidad: 2 },
        { productoId: "fernet", cantidad: 1 },
      ],
    };
    expect(descripcionPromocion(combo, PRODUCTOS)).toBe(`2 Coca + Fernet a ${platita.format(19000)}`);
  });
});

describe("promocionesDeProducto", () => {
  it("encuentra las promos activas que incluyen un producto", () => {
    const resultado = promocionesDeProducto([PROMO_CANTIDAD, PROMO_COMBO], "fernet");
    expect(resultado).toEqual([PROMO_COMBO]);
  });

  it("ignora promos pausadas", () => {
    const pausada = { ...PROMO_CANTIDAD, activa: false };
    expect(promocionesDeProducto([pausada], "alka")).toEqual([]);
  });

  it("devuelve varias si el producto participa de más de una promo", () => {
    const otraCombo: Promocion = { ...PROMO_COMBO, id: "p3", items: [{ productoId: "alka", cantidad: 1 }] };
    const resultado = promocionesDeProducto([PROMO_CANTIDAD, otraCombo], "alka");
    expect(resultado).toHaveLength(2);
  });
});
