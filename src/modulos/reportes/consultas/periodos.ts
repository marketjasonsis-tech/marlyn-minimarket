import { hoyISO, limitesDelDia } from "./calculos";

/** Funciones puras de fechas para Reportes → Períodos. Todas las
 *  fechas son "YYYY-MM-DD" locales; se usa el mediodía para que un
 *  cambio de horario no corra el día. */

export type AtajoPeriodo = "7d" | "30d" | "mes_actual" | "mes_pasado" | "6m" | "1a" | "personalizado";
export type Granularidad = "dia" | "semana" | "mes";
/** Ambos extremos inclusive. */
export type Periodo = { inicio: string; fin: string };

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function aFecha(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function sumarDias(iso: string, dias: number): string {
  const fecha = aFecha(iso);
  fecha.setDate(fecha.getDate() + dias);
  return hoyISO(fecha);
}

export function diasDelPeriodo(periodo: Periodo): number {
  return Math.round((aFecha(periodo.fin).getTime() - aFecha(periodo.inicio).getTime()) / MS_POR_DIA) + 1;
}

// `mes` es 1-12 y puede salirse de rango (0, -3…): Date lo normaliza al
// año anterior, así "6 meses atrás" cruza de año sin casos especiales.
function primeroDelMes(anio: number, mes: number): string {
  return hoyISO(new Date(anio, mes - 1, 1, 12));
}

// "Últimos 6 meses / último año" = los meses completos anteriores más
// el actual hasta hoy (arrancan el día 1), como pide el dueño para
// comparar meses enteros.
export function periodoDeAtajo(atajo: AtajoPeriodo, hoy: string): Periodo | null {
  const [anio, mes] = hoy.split("-").map(Number);
  switch (atajo) {
    case "7d":
      return { inicio: sumarDias(hoy, -6), fin: hoy };
    case "30d":
      return { inicio: sumarDias(hoy, -29), fin: hoy };
    case "mes_actual":
      return { inicio: primeroDelMes(anio, mes), fin: hoy };
    case "mes_pasado":
      return { inicio: primeroDelMes(anio, mes - 1), fin: sumarDias(primeroDelMes(anio, mes), -1) };
    case "6m":
      return { inicio: primeroDelMes(anio, mes - 5), fin: hoy };
    case "1a":
      return { inicio: primeroDelMes(anio, mes - 11), fin: hoy };
    case "personalizado":
      return null;
  }
}

export function periodoAnterior(periodo: Periodo): Periodo {
  const dias = diasDelPeriodo(periodo);
  const fin = sumarDias(periodo.inicio, -1);
  return { inicio: sumarDias(fin, -(dias - 1)), fin };
}

export function elegirGranularidad(periodo: Periodo): Granularidad {
  const dias = diasDelPeriodo(periodo);
  if (dias <= 31) return "dia";
  if (dias <= 200) return "semana";
  return "mes";
}

export function limitesDelPeriodo(periodo: Periodo): { desde: string; hasta: string } {
  return { desde: limitesDelDia(periodo.inicio).desde, hasta: limitesDelDia(periodo.fin).hasta };
}

// null cuando no hay base de comparación: el período anterior sin
// ventas no tiene un "% de cambio" con sentido (sería infinito).
export function variacionPorcentual(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((actual - anterior) / anterior) * 10000) / 100;
}

export function periodoValido(periodo: Periodo): boolean {
  return periodo.inicio !== "" && periodo.fin !== "" && periodo.inicio <= periodo.fin;
}

export function zonaLocal(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
