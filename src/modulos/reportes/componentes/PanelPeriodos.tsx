"use client";

import { useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { hoyISO } from "../consultas/calculos";
import {
  elegirGranularidad,
  periodoAnterior,
  periodoDeAtajo,
  periodoValido,
  variacionPorcentual,
  type AtajoPeriodo,
  type Periodo,
} from "../consultas/periodos";
import { obtenerReportePeriodo } from "../consultas/reportes";
import type { ReportePeriodo } from "../tipos";
import { GraficoEvolucion } from "./GraficoEvolucion";
import { SelectorPeriodo } from "./SelectorPeriodo";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export function PanelPeriodos() {
  const [atajo, setAtajo] = useState<AtajoPeriodo>("30d");
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDeAtajo("30d", hoyISO())!);
  const [comparar, setComparar] = useState(false);
  // El resultado guarda la clave con la que se pidió: "cargando" y
  // "error" se derivan de compararla con la clave actual, así el efecto
  // solo actualiza estado desde los callbacks de la promesa (regla
  // react-hooks/set-state-in-effect del proyecto).
  const [resultado, setResultado] = useState<{
    clave: string;
    actual: ReportePeriodo;
    previo: ReportePeriodo | null;
  } | null>(null);
  const [claveConError, setClaveConError] = useState<string | null>(null);

  const valido = periodoValido(periodo);
  const granularidad = useMemo(() => (valido ? elegirGranularidad(periodo) : "dia"), [periodo, valido]);
  const clave = `${periodo.inicio}|${periodo.fin}|${comparar}`;

  useEffect(() => {
    if (!valido) return;
    let vigente = true;
    const supabase = crearClienteNavegador();
    Promise.all([
      obtenerReportePeriodo(supabase, periodo, granularidad),
      comparar ? obtenerReportePeriodo(supabase, periodoAnterior(periodo), granularidad) : Promise.resolve(null),
    ])
      .then(([actual, previo]) => {
        if (vigente) setResultado({ clave, actual, previo });
      })
      .catch(() => {
        if (vigente) setClaveConError(clave);
      });
    return () => {
      vigente = false;
    };
  }, [periodo, granularidad, comparar, valido, clave]);

  const cargando = valido && resultado?.clave !== clave && claveConError !== clave;
  const error = valido && claveConError === clave ? "No se pudo cargar el reporte. Probá de nuevo." : null;
  const actual = resultado?.actual ?? null;
  const previo = comparar ? (resultado?.previo ?? null) : null;

  function elegirAtajo(nuevo: AtajoPeriodo) {
    setAtajo(nuevo);
    const definido = periodoDeAtajo(nuevo, hoyISO());
    if (definido) setPeriodo(definido);
  }

  const variacion = actual && previo ? variacionPorcentual(actual.total, previo.total) : null;

  return (
    <div className="flex flex-col gap-4">
      <SelectorPeriodo
        atajo={atajo}
        periodo={periodo}
        comparar={comparar}
        alElegirAtajo={elegirAtajo}
        alCambiarPeriodo={setPeriodo}
        alCambiarComparar={setComparar}
      />

      {!valido && (
        <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">
          Elegí una fecha de inicio y una de fin, y que el inicio no sea posterior al fin.
        </p>
      )}
      {error && (
        <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">{error}</p>
      )}

      {valido && actual && (
        <div className={`flex flex-col gap-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">Volumen de ventas</p>
            <p className="numero mt-1 text-3xl font-semibold text-texto">{platita.format(actual.total)}</p>
            {comparar && previo && (
              <p className="mt-1 text-sm text-texto-suave">
                {variacion === null ? (
                  "—"
                ) : (
                  <span className={variacion >= 0 ? "text-ok" : "text-alerta"}>
                    {variacion >= 0 ? "↑" : "↓"} {Math.abs(variacion).toLocaleString("es-AR")}%
                  </span>
                )}{" "}
                vs período anterior {platita.format(previo.total)}
              </p>
            )}
          </div>

          <GraficoEvolucion serie={actual.serie} anterior={previo?.serie} />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { etiqueta: "Cantidad de ventas", valor: String(actual.cantidad) },
              { etiqueta: "Ticket promedio", valor: platita.format(actual.ticketPromedio) },
              { etiqueta: "Balance", valor: platita.format(actual.margen), negativo: actual.margen < 0 },
            ].map((tarjeta) => (
              <div key={tarjeta.etiqueta} className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">{tarjeta.etiqueta}</p>
                <p className={`numero mt-1 text-2xl font-semibold ${tarjeta.negativo ? "text-alerta" : "text-texto"}`}>
                  {tarjeta.valor}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
