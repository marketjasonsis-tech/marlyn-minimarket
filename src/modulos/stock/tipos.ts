export type Categoria = {
  id: string;
  nombre: string;
};

// La definición canónica de Proveedor vive en el módulo proveedores
// (tiene su propia pantalla desde /proveedores); se reexporta acá para
// no tener que tocar los imports de los formularios de producto, que
// ya lo traían de "../tipos".
export type { Proveedor } from "@/modulos/proveedores/tipos";

export type Producto = {
  id: string;
  nombre: string;
  categoriaId: string | null;
  proveedorId: string | null;
  codigoBarras: string | null;
  /** Hasta 5 códigos extra, además del principal (pedido del dueño,
   *  2026-09-02: las salsas Arcor que van al mismo precio, y los
   *  productos a los que el fabricante les cambió el código).
   *  Vienen de productos_codigos_barras vía la vista. */
  codigosAdicionales: string[];
  // null cuando lo consulta un operador (Fase 1 de
  // PLAN-ROLES-AUDITORIA.md — productos_visibles lo oculta a nivel
  // base, no es un recorte de la UI). Nunca null para el dueño.
  precioCosto: number | null;
  precioVenta: number;
  // Cómo se llegó a precioVenta la última vez que se calculó en el
  // formulario — se guarda para que editar el producto más adelante no
  // arranque la calculadora en blanco (mismo criterio que
  // `porcentaje_ganancia` en miadmin/domain/models/producto.py).
  incluyeIva: boolean;
  porcentajeGanancia: number | null;
  stockActual: number;
  stockMinimo: number;
  unidad: "unidad" | "kg" | "litro";
  activo: boolean;
  /** El dueño decidió no volver a comprarlo (ver README: "No comprar
   *  más"). Se avisa en pedidos y alertas de stock; nunca bloquea nada. */
  noComprar: boolean;
  noComprarMotivo: string | null;
  /** ISO. null si no está marcado. */
  noComprarDesde: string | null;
};
