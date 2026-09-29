/** Función pura: sin Supabase ni navegador, para poder testearla con
 *  Vitest sola (mismo criterio que el resto del proyecto). */

// Pedido explícito del cliente, 2026-08-26: un nombre largo ("CABALLA
// AL NATURAL /EN ACEITE Y EN AGUA CARACAS 380GR") envolvía a una
// segunda línea en la pantalla al cliente — como la fila es un flex
// con items-baseline, el precio quedaba pegado a la altura de la
// PRIMERA línea del nombre en vez de acompañarlo. No hay forma barata
// de medir el ancho real renderizado en este componente (sin
// ResizeObserver/canvas), así que se aproxima por cantidad de
// caracteres: cuanto más largo el nombre, más chica la clase de
// Tailwind, para que términos casi siempre entren en una sola línea.
// Los cortes son heurísticos, no exactos — si algún nombre real sigue
// sin entrar, ajustar estos números primero antes de complicar la
// solución con medición real.
const CORTES: [maximo: number, clase: string][] = [
  [28, "text-2xl"],
  [40, "text-xl"],
  [55, "text-lg"],
  [Infinity, "text-base"],
];

export function tamañoTextoItem(nombre: string): string {
  const [, clase] = CORTES.find(([maximo]) => nombre.length <= maximo)!;
  return clase;
}

// Un producto por peso (kg/litro) se vende por gramos o por monto, y la
// cantidad en kg queda como "0.08333": no le sirve al cliente en la TV,
// que solo necesita ver el nombre y cuánto paga (pedido de Jason). null =
// no mostrar cantidad.
export function etiquetaCantidadItem(item: { cantidad: number; porPeso?: boolean }): string | null {
  return item.porPeso ? null : `${item.cantidad} ×`;
}
