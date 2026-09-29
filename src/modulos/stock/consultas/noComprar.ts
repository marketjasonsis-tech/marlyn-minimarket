import type { SupabaseClient } from "@supabase/supabase-js";
import type { Producto } from "../tipos";

/** Funciones puras + un update: la lista "no comprar más" es solo una
 *  marca en el producto (ver el spec 2026-09-29). */

export function limpiarMotivo(texto: string): string | null {
  const limpio = texto.trim();
  return limpio === "" ? null : limpio;
}

// Al desmarcar hay que limpiar motivo y fecha: la tabla tiene un check
// (productos_no_comprar_coherente) que no deja motivo/fecha sueltos.
// Si ya estaba marcado, `desdeActual` conserva la fecha original al
// editar solo el motivo.
export function datosNoComprar(
  marcar: boolean,
  motivo: string,
  desdeActual: string | null = null,
  ahora: Date = new Date(),
) {
  if (!marcar) return { no_comprar: false, no_comprar_motivo: null, no_comprar_desde: null };
  return {
    no_comprar: true,
    no_comprar_motivo: limpiarMotivo(motivo),
    no_comprar_desde: desdeActual ?? ahora.toISOString(),
  };
}

// Un producto eliminado (activo = false) ya no se puede pedir ni
// vender, así que no ensucia la lista.
export function productosNoComprar(productos: Producto[]): Producto[] {
  return productos
    .filter((producto) => producto.activo && producto.noComprar)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function guardarNoComprar(
  supabase: SupabaseClient,
  productoId: string,
  marcar: boolean,
  motivo: string,
): Promise<void> {
  const { error } = await supabase.from("productos").update(datosNoComprar(marcar, motivo)).eq("id", productoId);
  if (error) throw error;
}
