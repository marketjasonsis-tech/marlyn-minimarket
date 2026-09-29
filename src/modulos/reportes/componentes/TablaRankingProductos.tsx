"use client";

import { useEffect, useState } from "react";
import { Insignia } from "@/componentes/Insignia";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { BotonNoComprar } from "@/modulos/stock/componentes/BotonNoComprar";
import { EtiquetaNoComprar } from "@/modulos/stock/componentes/EtiquetaNoComprar";
import type { Periodo } from "../consultas/periodos";
import { obtenerRankingProductos } from "../consultas/reportes";
import type { FilaRanking, OrdenRanking, SentidoRanking } from "../tipos";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });
const LIMITES = [10, 25, 50];

const clasesSelect =
  "rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-1.5 text-sm text-texto outline-none focus-visible:border-acento";

function textoCantidad(fila: FilaRanking): string {
  return `${numero.format(fila.cantidad)} ${fila.unidad === "unidad" ? "u" : fila.unidad}`;
}

function Ranking({
  titulo,
  periodo,
  sentido,
  orden,
  limite,
}: {
  titulo: string;
  periodo: Periodo;
  sentido: SentidoRanking;
  orden: OrdenRanking;
  limite: number;
}) {
  // Misma técnica que PanelPeriodos: "cargando" y "error" se derivan de
  // la clave del pedido; `version` fuerza recargar tras marcar/quitar
  // "no comprar más" (regla react-hooks/set-state-in-effect).
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState<{ clave: string; filas: FilaRanking[] } | null>(null);
  const [claveConError, setClaveConError] = useState<string | null>(null);
  const clave = `${periodo.inicio}|${periodo.fin}|${orden}|${sentido}|${limite}|${version}`;

  useEffect(() => {
    let vigente = true;
    obtenerRankingProductos(crearClienteNavegador(), { periodo, orden, sentido, limite })
      .then((filas) => {
        if (vigente) setResultado({ clave, filas });
      })
      .catch(() => {
        if (vigente) setClaveConError(clave);
      });
    return () => {
      vigente = false;
    };
  }, [periodo, orden, sentido, limite, clave]);

  const error = claveConError === clave;
  const filas = resultado?.filas ?? null;
  const cargando = resultado?.clave !== clave && !error;

  return (
    <div className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
      <p className="mb-3 text-sm font-semibold text-texto">{titulo}</p>
      {error ? (
        <p className="text-sm text-alerta">No se pudo cargar el ranking. Probá de nuevo.</p>
      ) : filas === null ? (
        <p className="py-6 text-center text-sm text-texto-suave">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="py-6 text-center text-sm text-texto-suave">No hay productos para mostrar.</p>
      ) : (
        <ul className={`flex flex-col divide-y divide-linea transition-opacity ${cargando ? "opacity-50" : ""}`}>
          {filas.map((fila, indice) => (
            <li key={fila.productoId} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-texto">
                  <span className="numero mr-2 text-xs text-texto-suave">{indice + 1}.</span>
                  {fila.nombre}
                  {fila.nuevo && (
                    <span className="ml-2">
                      <Insignia variante="ok">nuevo</Insignia>
                    </span>
                  )}
                </span>
                {fila.noComprar && <EtiquetaNoComprar motivo={fila.noComprarMotivo} />}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="numero text-texto">
                  {orden === "monto" ? platita.format(fila.monto) : textoCantidad(fila)}
                </span>
                <span className="numero text-xs text-texto-suave">
                  {orden === "monto" ? textoCantidad(fila) : platita.format(fila.monto)}
                </span>
                <BotonNoComprar
                  producto={{ id: fila.productoId, nombre: fila.nombre, noComprar: fila.noComprar }}
                  onCambio={() => setVersion((anterior) => anterior + 1)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TablaRankingProductos({ periodo }: { periodo: Periodo }) {
  // Por defecto por monto: hay productos por kg/litro y no se pueden
  // comparar en unidades contra los de unidad.
  const [orden, setOrden] = useState<OrdenRanking>("monto");
  const [limite, setLimite] = useState(10);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-texto-suave">Ordenar por</span>
          <select className={clasesSelect} value={orden} onChange={(e) => setOrden(e.target.value as OrdenRanking)}>
            <option value="monto">Monto vendido</option>
            <option value="cantidad">Unidades vendidas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-texto-suave">Mostrar</span>
          <select className={clasesSelect} value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
            {LIMITES.map((valor) => (
              <option key={valor} value={valor}>
                Top {valor}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Ranking titulo="Más vendidos" periodo={periodo} sentido="desc" orden={orden} limite={limite} />
        <Ranking titulo="Menos vendidos" periodo={periodo} sentido="asc" orden={orden} limite={limite} />
      </div>
    </div>
  );
}
