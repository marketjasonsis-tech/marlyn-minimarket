"use client";

import { useState } from "react";
import { Insignia } from "@/componentes/Insignia";
import { EtiquetaNoComprar } from "@/modulos/stock/componentes/EtiquetaNoComprar";
import type { Producto } from "@/modulos/stock/tipos";

const TAMANO_PAGINA = 8;

const clasesBotonPagina =
  "rounded-[var(--radius-base)] p-1 text-texto-suave hover:bg-fondo hover:text-texto disabled:opacity-30 disabled:pointer-events-none";

// Mismo criterio que la columna "Estado" de ListaProductos.tsx en
// Stock — se repite acá en vez de importar de ahí porque es una sola
// comparación, no vale la pena una función compartida para eso.
export function PanelAlertasStock({ productos }: { productos: Producto[] }) {
  const productosBajos = productos.filter(
    (producto) => producto.activo && producto.stockActual <= producto.stockMinimo,
  );

  // Un catálogo grande puede dejar decenas de productos por debajo del
  // mínimo a la vez — sin paginar, la tarjeta se estira hasta el final
  // de la pantalla (pedido explícito de Enzo, 2026-08-15).
  const [pagina, setPagina] = useState(0);
  const totalPaginas = Math.max(1, Math.ceil(productosBajos.length / TAMANO_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas - 1);
  const productosPagina = productosBajos.slice(
    paginaSegura * TAMANO_PAGINA,
    paginaSegura * TAMANO_PAGINA + TAMANO_PAGINA,
  );

  return (
    <div className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-texto">Alertas de stock</p>
        {productosBajos.length > 0 && (
          <span className="numero text-xs text-texto-suave">{productosBajos.length}</span>
        )}
      </div>
      {productosBajos.length === 0 ? (
        <p className="py-8 text-center text-sm text-texto-suave">Todo el stock está en su nivel esperado.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {productosPagina.map((producto) => (
              <li key={producto.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex flex-col gap-0.5 text-texto">
                  {producto.nombre}
                  {producto.noComprar && <EtiquetaNoComprar motivo={producto.noComprarMotivo} />}
                </span>
                <span className="flex items-center gap-2">
                  <span className="numero text-xs text-texto-suave">{producto.stockActual} u</span>
                  <Insignia variante="alerta">reponer</Insignia>
                </span>
              </li>
            ))}
          </ul>

          {totalPaginas > 1 && (
            <div className="mt-3 flex items-center justify-between border-t border-linea pt-3">
              <button
                type="button"
                onClick={() => setPagina((anterior) => Math.max(0, anterior - 1))}
                disabled={paginaSegura === 0}
                aria-label="Página anterior"
                className={clasesBotonPagina}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <span className="numero text-xs text-texto-suave">
                Página {paginaSegura + 1} de {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => setPagina((anterior) => Math.min(totalPaginas - 1, anterior + 1))}
                disabled={paginaSegura === totalPaginas - 1}
                aria-label="Página siguiente"
                className={clasesBotonPagina}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
