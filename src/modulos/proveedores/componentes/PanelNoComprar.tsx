"use client";

import { useMemo } from "react";
import { BotonNoComprar } from "@/modulos/stock/componentes/BotonNoComprar";
import { productosNoComprar } from "@/modulos/stock/consultas/noComprar";
import type { Producto } from "@/modulos/stock/tipos";
import type { Proveedor } from "../tipos";

const columnas = ["Producto", "Proveedor", "Motivo", "Desde", ""];

export function PanelNoComprar({ productos, proveedores }: { productos: Producto[]; proveedores: Proveedor[] }) {
  const lista = useMemo(() => productosNoComprar(productos), [productos]);
  const nombreProveedor = useMemo(
    () => new Map(proveedores.map((proveedor) => [proveedor.id, proveedor.nombre])),
    [proveedores],
  );

  return (
    <section className="mt-6 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-texto">No comprar más</h2>
        <p className="text-xs text-texto-suave">
          Productos que decidieron no volver a pedir. Aparecen con aviso al armar un pedido.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-base)] border border-linea bg-superficie">
        {lista.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-texto-suave">Todavía no marcaron ningún producto.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {columnas.map((columna, indice) => (
                  <th
                    key={indice}
                    className="border-b border-linea px-2.5 py-1.5 text-left font-[family-name:var(--font-numero)] text-[10px] font-medium uppercase tracking-wider text-texto-suave"
                  >
                    {columna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((producto) => (
                <tr key={producto.id} className="border-b border-linea last:border-b-0">
                  <td className="px-2.5 py-1.5 text-xs font-semibold text-texto">{producto.nombre}</td>
                  <td className="px-2.5 py-1.5 text-xs text-texto-suave">
                    {(producto.proveedorId && nombreProveedor.get(producto.proveedorId)) ?? "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-xs text-texto-suave">{producto.noComprarMotivo ?? "—"}</td>
                  <td className="numero px-2.5 py-1.5 text-xs text-texto-suave">
                    {producto.noComprarDesde ? new Date(producto.noComprarDesde).toLocaleDateString("es-AR") : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <BotonNoComprar producto={producto} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
