"use client";

import { useEffect, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { clienteConfig } from "@/config/cliente";
import { etiquetaCantidadItem, tamañoTextoItem } from "../consultas/formato";
import { CANAL_EVENTO_CARRITO, nombreCanalPantalla, type CarritoPantalla } from "../tipos";

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
    <main className="flex min-h-screen flex-col justify-between bg-marco px-10 py-10 text-white">
      <p className="font-[family-name:var(--font-display)] text-xl text-white/60">
        {clienteConfig.comercio.nombre}
      </p>
      <div className="flex-1 overflow-y-auto py-6">
        <ul className="flex flex-col gap-3">
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
      <div className="border-t border-white/20 pt-6">
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
