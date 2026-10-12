"use client";

import { useEffect, useRef, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { clienteConfig } from "@/config/cliente";
import { indiceItemAMostrar } from "../consultas/desplazamiento";
import { etiquetaCantidadItem, tamañoTextoItem } from "../consultas/formato";
import {
  CANAL_EVENTO_CARRITO,
  nombreCanalPantalla,
  type CarritoPantalla,
  type ItemCarritoPantalla,
} from "../tipos";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

// Vive fuera de (app): nunca hay sesión acá (la TV del mostrador no
// inicia sesión, por diseño). crearClienteNavegador() sin sesión activa
// ya opera como anon, que es justo el rol que puede llamar a
// resolver_pantalla() y escuchar el canal de Realtime.
export function PantallaEnVivo({ token }: { token: string }) {
  const [valido, setValido] = useState<boolean | null>(null);
  const [carrito, setCarrito] = useState<CarritoPantalla | null>(null);

  useEffect(() => {
    let vigente = true;
    const supabase = crearClienteNavegador();
    supabase
      .rpc("resolver_pantalla", { p_token: token })
      .then(({ data, error }) => {
        if (!vigente) return;
        setValido(!error && !!data);
      });
    return () => {
      vigente = false;
    };
  }, [token]);

  useEffect(() => {
    if (!valido) return;
    const supabase = crearClienteNavegador();
    const canal = supabase
      .channel(nombreCanalPantalla(token))
      .on("broadcast", { event: CANAL_EVENTO_CARRITO }, ({ payload }) => {
        setCarrito(payload as CarritoPantalla);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [valido, token]);

  // En la TV nadie puede scrollear (no hay mouse ni control): con cada
  // carrito que llega, la lista se corre sola hasta lo último que tocó
  // el cajero. Ver indiceItemAMostrar().
  const listaRef = useRef<HTMLUListElement>(null);
  const itemsAnterioresRef = useRef<ItemCarritoPantalla[]>([]);

  useEffect(() => {
    const items = carrito?.items ?? [];
    const indice = indiceItemAMostrar(itemsAnterioresRef.current, items);
    itemsAnterioresRef.current = items;
    if (indice === null) return;
    listaRef.current?.children[indice]?.scrollIntoView({ block: "nearest" });
  }, [carrito]);

  if (valido === false) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-marco px-8 text-center text-white">
        <p className="font-[family-name:var(--font-display)] text-2xl">Este código no es válido</p>
        <p className="max-w-md text-white/70">
          Pedile al dueño el link actualizado desde &ldquo;Pantalla al cliente&rdquo; en el sistema.
        </p>
      </main>
    );
  }

  const hayCarrito = valido && carrito && carrito.items.length > 0;
  const ahorroPromociones =
    carrito?.items.reduce((acumulado, item) => acumulado + (item.promoAplicada?.ahorro ?? 0), 0) ?? 0;

  if (!hayCarrito) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-marco px-8 text-center text-white">
        {/* Protector de pantalla (complementos.protectorPantalla en
            config/cliente.ts): el fondo de <main> queda fijo, solo este
            bloque deriva lento (.protector-pantalla, en globals.css) —
            contra el quemado de un TV prendido muchas horas con la
            misma imagen fija. */}
        <div
          className={`flex flex-col items-center gap-4 ${
            clienteConfig.complementos.protectorPantalla ? "protector-pantalla" : ""
          }`}
        >
          <p className="font-[family-name:var(--font-display)] text-3xl">{clienteConfig.comercio.nombre}</p>
          <p className="max-w-md text-white/70">
            En cuanto el mostrador empiece a cobrar, acá va a aparecer cada
            producto escaneado y el total.
          </p>
        </div>
      </main>
    );
  }

  return (
    // h-screen y no min-h-screen: con el alto mínimo, <main> crecía con
    // la lista en vez de limitarla, y en una compra larga el total
    // quedaba debajo del borde de la TV (reportado por el cliente con
    // 9 productos, en una TV que le da 540px de alto al navegador). Con
    // el alto fijo, lo único que se achica es la lista: el nombre del
    // comercio y el total quedan siempre a la vista.
    <main className="flex h-screen flex-col justify-between bg-marco px-10 py-10 text-white">
      <p className="shrink-0 font-[family-name:var(--font-display)] text-xl text-white/60">
        {clienteConfig.comercio.nombre}
      </p>
      {/* scroll-py-6 = el mismo py-6: sin eso scrollIntoView deja la fila
          pegada al borde, tocando la línea del total. La máscara
          desvanece lo que se va por arriba a lo largo de ese mismo
          margen, en vez de cortar una fila por la mitad contra el nombre
          del comercio; sin desplazar no tapa nada (la primera fila
          arranca justo donde la máscara ya es opaca). */}
      <div className="min-h-0 flex-1 scroll-py-6 overflow-y-auto py-6 [mask-image:linear-gradient(to_bottom,transparent_0.5rem,black_1.5rem)]">
        <ul ref={listaRef} className="flex flex-col gap-3">
          {carrito.items.map((item) => (
            <li key={item.productoId} className={tamañoTextoItem(item.nombre)}>
              <div className="flex items-baseline justify-between gap-4">
                <span>
                  {etiquetaCantidadItem(item) && (
                    <>
                      <span className="numero text-white/60">{etiquetaCantidadItem(item)}</span>{" "}
                    </>
                  )}
                  {item.nombre}
                </span>
                <span className="numero shrink-0 font-semibold">
                  {platita.format(item.subtotal ?? item.cantidad * item.precioUnitario)}
                </span>
              </div>
              {item.promoAplicada && (
                <p className="numero text-sm font-medium text-acento">
                  🏷️ {item.promoAplicada.nombre} · ahorrás {platita.format(item.promoAplicada.ahorro)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="shrink-0 border-t border-white/20 pt-6">
        {ahorroPromociones > 0 && (
          <p className="numero mb-1 text-right text-lg font-semibold text-acento">
            Ahorrás {platita.format(ahorroPromociones)} con esta compra
          </p>
        )}
        <div className="flex items-baseline justify-between">
          <span className="font-[family-name:var(--font-display)] text-2xl text-white/80">Total</span>
          <span className="numero text-6xl font-semibold text-acento">{platita.format(carrito.total)}</span>
        </div>
      </div>
    </main>
  );
}
