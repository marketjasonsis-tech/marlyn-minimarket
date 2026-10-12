/** Función pura: sin Supabase ni navegador, para poder testearla con
 *  Vitest sola (mismo criterio que el resto del proyecto). */

import type { ItemCarritoPantalla } from "../tipos";

type ItemComparable = Pick<ItemCarritoPantalla, "productoId" | "cantidad">;

// La TV del mostrador no tiene mouse ni control: cuando la lista ya no
// entra en pantalla, alguien tiene que decidir qué parte se ve. Se
// muestra lo último que tocó el cajero — el producto recién escaneado
// (va al final) o la fila a la que le acaba de sumar una unidad, que
// puede estar en cualquier lado. null = nada que seguir (se sacó un
// producto, o la terminal retransmitió el mismo carrito): la lista se
// queda donde está.
export function indiceItemAMostrar(anteriores: ItemComparable[], actuales: ItemComparable[]): number | null {
  const cantidadAnterior = new Map(anteriores.map((item) => [item.productoId, item.cantidad]));
  for (let indice = actuales.length - 1; indice >= 0; indice--) {
    const item = actuales[indice];
    if (cantidadAnterior.get(item.productoId) !== item.cantidad) return indice;
  }
  return null;
}
