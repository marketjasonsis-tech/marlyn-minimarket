"use client";

import { Campo } from "@/componentes/Campo";
import { hoyISO } from "../consultas/calculos";
import type { AtajoPeriodo, Periodo } from "../consultas/periodos";

const atajos: { id: AtajoPeriodo; titulo: string }[] = [
  { id: "7d", titulo: "Últimos 7 días" },
  { id: "30d", titulo: "Últimos 30 días" },
  { id: "mes_actual", titulo: "Este mes" },
  { id: "mes_pasado", titulo: "Mes pasado" },
  { id: "6m", titulo: "Últimos 6 meses" },
  { id: "1a", titulo: "Último año" },
  { id: "personalizado", titulo: "Personalizado" },
];

const clasesSelect =
  "rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-2 text-sm text-texto outline-none focus-visible:border-acento focus-visible:ring-2 focus-visible:ring-acento/40";

export function SelectorPeriodo({
  atajo,
  periodo,
  comparar,
  alElegirAtajo,
  alCambiarPeriodo,
  alCambiarComparar,
}: {
  atajo: AtajoPeriodo;
  periodo: Periodo;
  comparar: boolean;
  alElegirAtajo: (atajo: AtajoPeriodo) => void;
  alCambiarPeriodo: (periodo: Periodo) => void;
  alCambiarComparar: (comparar: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-texto-suave">Período</span>
        <select
          className={clasesSelect}
          value={atajo}
          onChange={(evento) => alElegirAtajo(evento.target.value as AtajoPeriodo)}
        >
          {atajos.map((opcion) => (
            <option key={opcion.id} value={opcion.id}>
              {opcion.titulo}
            </option>
          ))}
        </select>
      </label>

      {atajo === "personalizado" && (
        <>
          <Campo
            etiqueta="Desde"
            id="periodoDesde"
            type="date"
            value={periodo.inicio}
            max={hoyISO()}
            onChange={(evento) => alCambiarPeriodo({ ...periodo, inicio: evento.target.value })}
          />
          <Campo
            etiqueta="Hasta"
            id="periodoHasta"
            type="date"
            value={periodo.fin}
            max={hoyISO()}
            onChange={(evento) => alCambiarPeriodo({ ...periodo, fin: evento.target.value })}
          />
        </>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-texto-suave">Comparación</span>
        <select
          className={clasesSelect}
          value={comparar ? "anterior" : "ninguna"}
          onChange={(evento) => alCambiarComparar(evento.target.value === "anterior")}
        >
          <option value="ninguna">Sin comparar</option>
          <option value="anterior">Período anterior</option>
        </select>
      </label>
    </div>
  );
}
