/** Estado de una consulta identificada por una `clave` (período, orden…).
 *  El resultado y el error guardan la clave con la que se pidieron; comparar
 *  con la clave actual evita un setState sincrónico en el efecto. Un
 *  resultado de la clave actual siempre gana sobre un error viejo. */
export function estadoDeCarga(clave: string, claveDelResultado: string | null, claveConError: string | null) {
  const listo = claveDelResultado === clave;
  const error = !listo && claveConError === clave;
  return { listo, error, cargando: !listo && !error };
}
