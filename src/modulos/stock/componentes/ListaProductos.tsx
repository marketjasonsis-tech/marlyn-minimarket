"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/componentes/Boton";
import { Insignia } from "@/componentes/Insignia";
import { coincideBusqueda } from "@/lib/busqueda";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { useEsDueño } from "@/lib/supabase/PerfilContext";
import { BotonEliminarProducto } from "./BotonEliminarProducto";
import { eliminarProducto } from "../consultas/eliminarProducto";
import { EtiquetasProductos } from "./EtiquetasProductos";
import { FormularioAjusteStock } from "./FormularioAjusteStock";
import { FormularioCargaRapida } from "./FormularioCargaRapida";
import { FormularioEditarProducto } from "./FormularioEditarProducto";
import { contieneCodigo } from "../consultas/codigosBarras";
import type { Categoria, Producto, Proveedor } from "../tipos";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

const clasesFiltro =
  "rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-1.5 text-sm text-texto outline-none focus-visible:border-acento focus-visible:ring-2 focus-visible:ring-acento/40";

const clasesBotonPagina =
  "rounded-[var(--radius-base)] p-1 text-texto-suave hover:bg-fondo hover:text-texto disabled:opacity-30 disabled:pointer-events-none";

const TAMANO_PAGINA = 50;

type FiltroEstado = "todos" | "ok" | "reponer";

export function ListaProductos({
  productos,
  categorias,
  proveedores,
}: {
  productos: Producto[];
  categorias: Categoria[];
  proveedores: Proveedor[];
}) {
  const esDueño = useEsDueño();
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const inputBusquedaRef = useRef<HTMLInputElement>(null);
  const [proveedorId, setProveedorId] = useState("");
  const [estado, setEstado] = useState<FiltroEstado>("todos");

  // Pedido explícito de Jason (2026-09-11), con el riesgo ya charlado y
  // aceptado: a los 2 segundos sin tipear, se selecciona todo para
  // poder escribir encima sin ir a buscar el botón "✕" ni clickear
  // afuera y volver a entrar (bajado de 3s a pedido de Jason, mismo día).
  // Conviven los tres mecanismos: este timer, el select-on-focus de
  // abajo y el botón "✕". Solo si el cursor sigue en el buscador:
  // select() en Chrome también le da el foco, y si se abría "Editar" y
  // se empezaba a tipear antes de los 2s, lo tipeado iba a parar al
  // buscador de atrás del modal (mismo caso que Ventas).
  useEffect(() => {
    if (!busqueda) return;
    const temporizador = setTimeout(() => {
      if (document.activeElement === inputBusquedaRef.current) inputBusquedaRef.current?.select();
    }, 2000);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  // "Eliminado" (activo = false) deja de ser parte del catálogo activo
  // — no se lista acá ni se puede vender, pero la fila sigue en la
  // base porque tiene ventas/movimientos de stock que la referencian.
  const productosActivos = useMemo(() => productos.filter((producto) => producto.activo), [productos]);

  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [eliminandoSeleccion, setEliminandoSeleccion] = useState(false);
  const [resultadoSeleccion, setResultadoSeleccion] = useState<string | null>(null);

  const nombrePorCategoria = useMemo(
    () => new Map(categorias.map((categoria) => [categoria.id, categoria.nombre])),
    [categorias],
  );

  const paraReponer = useMemo(
    () => productosActivos.filter((producto) => producto.stockActual <= producto.stockMinimo),
    [productosActivos],
  );

  const filtrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();

    return productosActivos.filter((producto) => {
      const rubro = producto.categoriaId ? (nombrePorCategoria.get(producto.categoriaId) ?? "") : "";
      const coincideTermino =
        !termino ||
        coincideBusqueda(producto.nombre, busqueda) ||
        contieneCodigo(producto, termino) ||
        rubro.toLowerCase().includes(termino);

      const coincideProveedor = !proveedorId || producto.proveedorId === proveedorId;

      const reponer = producto.stockActual <= producto.stockMinimo;
      const coincideEstado = estado === "todos" || (estado === "reponer" ? reponer : !reponer);

      return coincideTermino && coincideProveedor && coincideEstado;
    });
  }, [productosActivos, busqueda, proveedorId, estado, nombrePorCategoria]);

  // Con el catálogo real (~2991 productos) renderizar `filtrados` entero
  // como filas de tabla es pesado apenas se entra sin buscar nada
  // todavía — se pagina de a 50. "Adjusting state when a prop changes"
  // (mismo patrón que PanelListaSimple.tsx): al cambiar cualquier
  // filtro hay que volver a la página 1, no quedarse en una que puede
  // ni existir ya para el resultado nuevo.
  const claveFiltro = `${busqueda}|${proveedorId}|${estado}`;
  const [claveFiltroVista, setClaveFiltroVista] = useState(claveFiltro);
  const [pagina, setPagina] = useState(0);
  if (claveFiltro !== claveFiltroVista) {
    setClaveFiltroVista(claveFiltro);
    setPagina(0);
  }

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas - 1);
  const productosPagina = filtrados.slice(paginaSegura * TAMANO_PAGINA, paginaSegura * TAMANO_PAGINA + TAMANO_PAGINA);

  function activarModoSeleccion() {
    setSeleccionados(new Set());
    setResultadoSeleccion(null);
    setModoSeleccion(true);
  }

  function cancelarSeleccion() {
    setModoSeleccion(false);
    setSeleccionados(new Set());
  }

  function alternarSeleccionado(id: string) {
    setSeleccionados((anteriores) => {
      const nuevo = new Set(anteriores);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  // Selecciona solo lo que se ve en esta página, no todo `filtrados"
  // — con la lista paginada, tildar "todos" y borrar sin querer
  // productos de otra página que ni se llegaron a ver sería peligroso.
  function alternarSeleccionarTodos() {
    const idsPagina = productosPagina.map((producto) => producto.id);
    const yaEstanTodos = idsPagina.every((id) => seleccionados.has(id));

    setSeleccionados((anteriores) => {
      const nuevo = new Set(anteriores);
      for (const id of idsPagina) {
        if (yaEstanTodos) nuevo.delete(id);
        else nuevo.add(id);
      }
      return nuevo;
    });
  }

  async function eliminarSeleccionados() {
    if (seleccionados.size === 0) return;
    setEliminandoSeleccion(true);
    setResultadoSeleccion(null);

    const supabase = crearClienteNavegador();
    let eliminados = 0;
    let marcados = 0;
    let errores = 0;

    for (const id of seleccionados) {
      const resultado = await eliminarProducto(supabase, id);
      if (resultado === "eliminado") eliminados++;
      else if (resultado === "marcado_eliminado") marcados++;
      else errores++;
    }

    setEliminandoSeleccion(false);
    setModoSeleccion(false);
    setSeleccionados(new Set());

    const partes = [];
    if (eliminados > 0) partes.push(`${eliminados} eliminados`);
    if (marcados > 0) partes.push(`${marcados} marcados como eliminados (tenían ventas)`);
    if (errores > 0) partes.push(`${errores} no se pudieron borrar`);
    setResultadoSeleccion(partes.join(", "));

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <input
            ref={inputBusquedaRef}
            className={`${clasesFiltro} w-full ${busqueda ? "pr-8" : ""}`}
            placeholder="Buscar por nombre, código o rubro..."
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            // Pedido del dueño: al volver a este campo con una búsqueda
            // vieja adentro, que quede todo seleccionado para poder
            // escribir encima directo, sin borrar a mano primero — mismo
            // criterio que ya usan los campos numéricos (Campo.tsx).
            onFocus={(evento) => evento.currentTarget.select()}
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => {
                setBusqueda("");
                inputBusquedaRef.current?.focus();
              }}
              aria-label="Vaciar búsqueda"
              // Botón "vaciar" aparte del select-on-focus y del timer de
              // arriba: para limpiar sin esperar los 2s ni tener que
              // clickear afuera y volver a entrar.
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-texto-suave hover:bg-fondo hover:text-texto"
            >
              ✕
            </button>
          )}
        </div>
        <select
          className={clasesFiltro}
          value={proveedorId}
          onChange={(evento) => setProveedorId(evento.target.value)}
        >
          <option value="">Todos los proveedores</option>
          {proveedores.map((proveedor) => (
            <option key={proveedor.id} value={proveedor.id}>
              {proveedor.nombre}
            </option>
          ))}
        </select>
        <select
          className={clasesFiltro}
          value={estado}
          onChange={(evento) => setEstado(evento.target.value as FiltroEstado)}
        >
          <option value="todos">Todos los estados</option>
          <option value="ok">Ok</option>
          <option value="reponer">Para reponer</option>
        </select>
        {!modoSeleccion && (
          <>
            <FormularioCargaRapida productos={productosActivos} />
            <EtiquetasProductos productos={productosActivos} />
            {esDueño && (
              <Boton
                type="button"
                variante="fantasma"
                className="px-2.5 py-1.5 text-xs"
                onClick={activarModoSeleccion}
              >
                Eliminar productos
              </Boton>
            )}
          </>
        )}
        <span className="ml-auto whitespace-nowrap text-xs text-texto-suave">
          {filtrados.length} de {productosActivos.length} productos · {paraReponer.length} para reponer
        </span>
      </div>

      {modoSeleccion && (
        <div className="flex items-center gap-3 rounded-[var(--radius-base)] border border-linea bg-fondo px-3 py-2">
          <span className="text-sm text-texto">{seleccionados.size} seleccionados</span>
          <Boton
            type="button"
            variante="peligro"
            className="px-2.5 py-1.5 text-xs"
            disabled={seleccionados.size === 0 || eliminandoSeleccion}
            onClick={eliminarSeleccionados}
          >
            {eliminandoSeleccion ? "Eliminando…" : "Eliminar seleccionados"}
          </Boton>
          <Boton type="button" variante="fantasma" className="px-2.5 py-1.5 text-xs" onClick={cancelarSeleccion}>
            Cancelar
          </Boton>
        </div>
      )}

      {resultadoSeleccion && (
        <p className="rounded-[var(--radius-base)] bg-ok-fondo px-3 py-2 text-sm text-ok">{resultadoSeleccion}</p>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-base)] border border-linea bg-superficie">
        {filtrados.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-texto-suave">
            No hay productos que coincidan con la búsqueda.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Código", "Producto", "Precio", "Stock", "Estado", modoSeleccion ? "" : "Acciones"].map(
                  (columna, indice) => (
                    <th
                      key={indice}
                      className={`border-b border-linea px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-texto-suave ${
                        columna === "Precio" || columna === "Stock" || columna === "Estado" || indice === 5
                          ? "text-right"
                          : "text-left"
                      }`}
                    >
                      {indice === 5 && modoSeleccion ? (
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todos los de esta página"
                          checked={productosPagina.length > 0 && productosPagina.every((p) => seleccionados.has(p.id))}
                          onChange={alternarSeleccionarTodos}
                          className="h-4 w-4 accent-acento"
                        />
                      ) : (
                        columna
                      )}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {productosPagina.map((producto) => {
                const reponer = producto.stockActual <= producto.stockMinimo;
                return (
                  <tr key={producto.id} className="border-b border-linea last:border-b-0">
                    <td className="numero px-2.5 py-2 text-sm text-texto-suave">
                      {producto.codigoBarras ?? "—"}
                      {producto.codigosAdicionales.length > 0 && (
                        <span
                          className="ml-1 text-xs text-texto-suave"
                          title={`Códigos adicionales: ${producto.codigosAdicionales.join(", ")}`}
                        >
                          +{producto.codigosAdicionales.length}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-sm font-semibold text-texto">{producto.nombre}</td>
                    <td className="numero px-2.5 py-2 text-right text-base font-bold text-texto">
                      {platita.format(producto.precioVenta)}
                    </td>
                    <td className="numero px-2.5 py-2 text-right text-sm font-semibold">{producto.stockActual}</td>
                    <td className="px-2.5 py-1.5 text-right">
                      <Insignia variante={reponer ? "alerta" : "ok"}>{reponer ? "reponer" : "ok"}</Insignia>
                    </td>
                    <td className="px-2.5 py-1.5">
                      {modoSeleccion ? (
                        <div className="flex justify-end">
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${producto.nombre}`}
                            checked={seleccionados.has(producto.id)}
                            onChange={() => alternarSeleccionado(producto.id)}
                            className="h-4 w-4 accent-acento"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          {/* Orden a pedido del dueño (2026-09-07):
                              Eliminar/Editar/Ajustar, invertido respecto
                              a como estaba (Ajustar/Editar/Eliminar). */}
                          <BotonEliminarProducto producto={producto} />
                          <FormularioEditarProducto producto={producto} proveedoresIniciales={proveedores} />
                          <FormularioAjusteStock producto={producto} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-3">
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
    </div>
  );
}
