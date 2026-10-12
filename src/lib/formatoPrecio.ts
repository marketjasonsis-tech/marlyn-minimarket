/** Funciones puras para el campo de precio con separador de miles
 *  (pedido del cliente: "si es mil pesos ponele 1.000, si es diez mil
 *  10.000"). El resto de la app guarda los precios como string numérico
 *  plano (punto decimal, sin separador de miles — lo que produce un
 *  <input type="number">); estas funciones solo traducen entre ese
 *  formato interno y lo que el usuario ve y tipea, en formato es-AR
 *  (punto de miles, coma decimal). */

const formateadorMiles = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** Del valor interno ("1500" o "1500.5") a lo que se muestra cuando el
 *  campo NO está enfocado ("1.500" o "1.500,5"). */
export function formatearPrecio(valorCrudo: string): string {
  if (valorCrudo === "" || valorCrudo === "-") return "";
  const numero = Number(valorCrudo);
  return Number.isFinite(numero) ? formateadorMiles.format(numero) : "";
}

/** De lo que el usuario tipeó (puede traer letras, varios puntos, etc.
 *  si pegó algo) a un texto válido para mostrar mientras edita: solo
 *  dígitos y como mucho UNA coma decimal. Nunca un punto — acá el punto
 *  es de miles, y quien tipea un precio en el mostrador usa coma para
 *  los centavos, no punto (convención es-AR). */
export function limpiarTipeoPrecio(textoTipeado: string): string {
  const soloDigitosYComa = textoTipeado.replace(/[^\d,]/g, "");
  const indicePrimeraComa = soloDigitosYComa.indexOf(",");
  if (indicePrimeraComa === -1) return soloDigitosYComa;

  const antesDeLaComa = soloDigitosYComa.slice(0, indicePrimeraComa + 1);
  const despuesDeLaComa = soloDigitosYComa.slice(indicePrimeraComa + 1).replace(/,/g, "");
  return antesDeLaComa + despuesDeLaComa;
}

/** Del texto ya limpio (con coma decimal) al valor interno que espera
 *  el resto del formulario (punto decimal, el mismo formato que
 *  entrega un <input type="number">). */
export function valorCrudoDesdeTipeo(textoLimpio: string): string {
  return textoLimpio.replace(",", ".");
}

/** La vuelta de valorCrudoDesdeTipeo: del valor interno a lo que se
 *  muestra al entrar a editar (sin punto de miles, con coma decimal).
 *  Sin esto, un valor con centavos entraría al campo con punto, y
 *  limpiarTipeoPrecio lo descartaría a la primera tecla ("1500.5"
 *  pasaría a "15005"). */
export function textoEdicionDesdeValorCrudo(valorCrudo: string): string {
  return valorCrudo.replace(".", ",");
}
