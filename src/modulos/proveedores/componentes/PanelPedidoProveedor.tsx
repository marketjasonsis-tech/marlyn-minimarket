"use client";

import { useMemo, useState } from "react";
import { Boton } from "@/componentes/Boton";
import { Modal } from "@/componentes/Modal";
import { clienteConfig } from "@/config/cliente";
import { EtiquetaNoComprar } from "@/modulos/stock/componentes/EtiquetaNoComprar";
import type { Producto } from "@/modulos/stock/tipos";
import type { Proveedor } from "../tipos";

// Deja solo dígitos y antepone el código de país si no está — el
// teléfono es texto libre sin formato validado (/proveedores), así que
// esto es una normalización mínima, no una garantía. Un celular
// argentino a veces necesita además un "9" después del 54
// (5493511234567) que no se puede inferir de forma confiable desde un
// número de 10 dígitos sin saber si es fijo o celular — si el link no
// abre bien, hay que cargar el teléfono ya en formato completo.
function numeroWhatsapp(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.startsWith("54") ? digitos : `54${digitos}`;
}

// Filtra en el cliente sobre la misma lista de productos que ya trae
// la página (sin consulta nueva): quedarse solo con los del proveedor.
export function PanelPedidoProveedor({ proveedor, productos }: { proveedor: Proveedor; productos: Producto[] }) {
  const [abierto, setAbierto] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [textoPedido, setTextoPedido] = useState<string | null>(null);
  const [textoWhatsapp, setTextoWhatsapp] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productosDelProveedor = useMemo(
    () => productos.filter((producto) => producto.proveedorId === proveedor.id),
    [productos, proveedor.id],
  );

  const marcadosElegidos = productosDelProveedor.filter(
    (producto) => seleccionados[producto.id] && producto.noComprar,
  );

  function abrir() {
    setSeleccionados({});
    setCantidades({});
    setTextoPedido(null);
    setTextoWhatsapp(null);
    setCopiado(false);
    setError(null);
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
  }

  function generarPedido() {
    setError(null);
    const elegidos = productosDelProveedor.filter((producto) => seleccionados[producto.id]);

    if (elegidos.length === 0) {
      setError("Elegí al menos un producto para el pedido");
      return;
    }

    const lineas = elegidos.map((producto) => {
      const cantidad = (cantidades[producto.id] ?? "").trim();
      return cantidad ? `${cantidad} x ${producto.nombre}` : `- ${producto.nombre}`;
    });

    // "Pedido para <proveedor>" tiene sentido al copiarlo (por ejemplo,
    // para pegarlo en una nota propia) pero no al mandárselo por
    // WhatsApp al proveedor mismo — ahí sobra decirle a quién es el
    // pedido, y suena raro. Reportado por el cliente, 2026-08-24.
    setTextoPedido(`Pedido para ${proveedor.nombre}:\n${lineas.join("\n")}`);
    setTextoWhatsapp(`Pedido de ${clienteConfig.comercio.nombre}:\n${lineas.join("\n")}`);
    setCopiado(false);
  }

  async function copiarPedido() {
    if (!textoPedido) return;
    try {
      await navigator.clipboard.writeText(textoPedido);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setError("No se pudo copiar. Seleccioná el texto a mano.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="text-xs font-medium text-texto-suave underline decoration-dotted underline-offset-2 hover:text-texto"
      >
        Productos y pedido
      </button>

      <Modal titulo={`Productos de ${proveedor.nombre}`} abierto={abierto} onCerrar={cerrar}>
        <div className="flex flex-col gap-4">
          {productosDelProveedor.length === 0 ? (
            <p className="text-sm text-texto-suave">
              Todavía no hay productos de este proveedor cargados. Asignalo desde &ldquo;Editar&rdquo; en Stock.
            </p>
          ) : (
            <>
              <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {productosDelProveedor.map((producto) => (
                  <li key={producto.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`chk-${producto.id}`}
                      checked={!!seleccionados[producto.id]}
                      onChange={(evento) =>
                        setSeleccionados({ ...seleccionados, [producto.id]: evento.target.checked })
                      }
                      className="h-4 w-4 accent-acento"
                    />
                    <label htmlFor={`chk-${producto.id}`} className="flex-1 text-sm text-texto">
                      {producto.nombre}
                      <span className="numero ml-1.5 text-xs text-texto-suave">
                        ({producto.stockActual} en góndola)
                      </span>
                      {producto.noComprar && (
                        <span className="ml-2">
                          <EtiquetaNoComprar motivo={producto.noComprarMotivo} />
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="cant."
                      value={cantidades[producto.id] ?? ""}
                      onChange={(evento) => setCantidades({ ...cantidades, [producto.id]: evento.target.value })}
                      className="numero w-16 rounded-[var(--radius-base)] border border-linea bg-superficie px-2 py-1 text-xs text-texto outline-none focus-visible:border-acento"
                    />
                  </li>
                ))}
              </ul>

              {marcadosElegidos.length > 0 && (
                <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">
                  Ojo: {marcadosElegidos.map((producto) => producto.nombre).join(", ")} está en la lista de
                  &ldquo;no comprar más&rdquo;. Revisá antes de pedirlo.
                </p>
              )}

              <Boton type="button" onClick={generarPedido}>
                Generar pedido
              </Boton>

              {textoPedido && (
                <div className="flex flex-col gap-2">
                  <textarea
                    readOnly
                    value={textoPedido}
                    rows={Math.min(10, textoPedido.split("\n").length + 1)}
                    className="numero rounded-[var(--radius-base)] border border-linea bg-fondo px-3 py-2 text-xs text-texto"
                  />
                  <div className="flex gap-2">
                    <Boton type="button" variante="confirmar" className="flex-1" onClick={copiarPedido}>
                      {copiado ? "¡Copiado!" : "Copiar"}
                    </Boton>
                    {proveedor.telefono && textoWhatsapp && (
                      <a
                        href={`https://wa.me/${numeroWhatsapp(proveedor.telefono)}?text=${encodeURIComponent(textoWhatsapp)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center justify-center rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-2 text-sm font-medium text-texto hover:border-marco"
                      >
                        Enviar por WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">{error}</p>
          )}

          <div className="flex justify-end">
            <Boton type="button" variante="fantasma" onClick={cerrar}>
              Cerrar
            </Boton>
          </div>
        </div>
      </Modal>
    </>
  );
}
