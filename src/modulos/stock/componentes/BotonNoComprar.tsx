"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/componentes/Boton";
import { Campo } from "@/componentes/Campo";
import { Modal } from "@/componentes/Modal";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { useEsDueño } from "@/lib/supabase/PerfilContext";
import { guardarNoComprar } from "../consultas/noComprar";

const clasesEnlace =
  "text-xs font-medium text-texto-suave underline decoration-dotted underline-offset-2 hover:text-texto disabled:opacity-50";

// Solo el dueño lo ve (la barrera real es la RLS de productos; esto
// evita mostrar un botón que no va a hacer nada). Si el producto ya
// está marcado ofrece quitarlo; si no, pide un motivo opcional.
export function BotonNoComprar({
  producto,
  onCambio,
}: {
  producto: { id: string; nombre: string; noComprar: boolean };
  onCambio?: () => void;
}) {
  const esDueño = useEsDueño();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!esDueño) return null;

  async function aplicar(marcar: boolean) {
    setGuardando(true);
    setError(null);
    try {
      await guardarNoComprar(crearClienteNavegador(), producto.id, marcar, motivo);
      setAbierto(false);
      setMotivo("");
      router.refresh();
      onCambio?.();
    } catch {
      setError("No se pudo guardar. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  if (producto.noComprar) {
    return (
      <>
        <button type="button" disabled={guardando} onClick={() => aplicar(false)} className={clasesEnlace}>
          Quitar de &ldquo;no comprar&rdquo;
        </button>
        {error && <span className="text-xs text-alerta">{error}</span>}
      </>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={clasesEnlace}>
        No comprar más
      </button>

      <Modal titulo="No comprar más" abierto={abierto} onCerrar={() => setAbierto(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-texto">
            <strong>{producto.nombre}</strong> va a aparecer con un aviso rojo cuando armes un pedido.
          </p>
          <Campo
            etiqueta="Motivo (opcional)"
            id={`motivoNoComprar-${producto.id}`}
            placeholder="Ej: se vence rápido, mala calidad"
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
          />
          {error && (
            <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="button" variante="peligro" disabled={guardando} onClick={() => aplicar(true)}>
              {guardando ? "Guardando…" : "Marcar"}
            </Boton>
          </div>
        </div>
      </Modal>
    </>
  );
}
