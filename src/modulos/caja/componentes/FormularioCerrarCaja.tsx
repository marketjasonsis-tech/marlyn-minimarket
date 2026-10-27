"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { Boton } from "@/componentes/Boton";
import { Campo } from "@/componentes/Campo";
import { Modal } from "@/componentes/Modal";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export function FormularioCerrarCaja({ turnoId, montoCalculado }: { turnoId: string; montoCalculado: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [montoContado, setMontoContado] = useState(String(montoCalculado));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diferencia, setDiferencia] = useState<number | null>(null);
  const [cerradaPorOtro, setCerradaPorOtro] = useState(false);

  function abrir() {
    setMontoContado(String(montoCalculado));
    setError(null);
    setDiferencia(null);
    setCerradaPorOtro(false);
    setAbierto(true);
  }

  function cerrarModal() {
    setAbierto(false);
    // Si ya se cerró la caja, recién ahora se vuelve a pedir el estado
    // (turno abierto/no) al servidor — mientras el modal mostraba el
    // resultado no tenía sentido que la pantalla de atrás ya hubiera
    // cambiado por debajo.
    if (diferencia !== null || cerradaPorOtro) router.refresh();
  }

  async function confirmarCierre() {
    setError(null);
    const contado = Number(montoContado);
    if (!Number.isFinite(contado) || contado < 0) {
      setError("El efectivo contado tiene que ser mayor o igual a cero");
      return;
    }

    setGuardando(true);
    const supabase = crearClienteNavegador();
    // Por función y no con un update directo: un colaborador no podía
    // cerrar una caja que había abierto otro (ver migración
    // 20261027100000_cerrar_caja_compartida.sql).
    const { error: errorRpc } = await supabase.rpc("cerrar_turno_caja", {
      p_turno_id: turnoId,
      p_monto_declarado: contado,
      p_monto_calculado: montoCalculado,
    });
    setGuardando(false);

    if (errorRpc) {
      const yaCerrada = /ya estaba cerrada/i.test(errorRpc.message);
      setCerradaPorOtro(yaCerrada);
      setError(yaCerrada ? "Esta caja ya la cerró otra persona." : "No se pudo cerrar la caja. Probá de nuevo.");
      return;
    }

    setDiferencia(contado - montoCalculado);
  }

  return (
    <>
      <Boton type="button" variante="peligro" onClick={abrir}>
        Cerrar caja
      </Boton>

      <Modal titulo="Cerrar caja" abierto={abierto} onCerrar={cerrarModal}>
        {diferencia !== null ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-texto">
              {diferencia === 0 && "Caja cerrada sin diferencias."}
              {diferencia > 0 && `Caja cerrada: sobran ${platita.format(diferencia)}.`}
              {diferencia < 0 && `Caja cerrada: faltan ${platita.format(Math.abs(diferencia))}.`}
            </p>
            <Boton type="button" variante="confirmar" onClick={cerrarModal}>
              Entendido
            </Boton>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-texto-suave">
              Contá el efectivo del cajón y anotá el total. El sistema compara contra lo que
              debería haber (apertura + ventas en efectivo del turno) y te muestra la diferencia.
            </p>
            <div className="rounded-[var(--radius-base)] bg-fondo px-4 py-3">
              <p className="text-xs text-texto-suave">Debería haber</p>
              <p className="numero text-lg font-semibold text-texto">{platita.format(montoCalculado)}</p>
            </div>
            <Campo
              etiqueta="Efectivo contado"
              id="montoContado"
              type="number"
              min={0}
              step="1"
              value={montoContado}
              onChange={(evento) => setMontoContado(evento.target.value)}
            />
            {error && (
              <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Boton type="button" variante="fantasma" onClick={cerrarModal}>
                Cancelar
              </Boton>
              <Boton type="button" variante="peligro" disabled={guardando} onClick={confirmarCierre}>
                {guardando ? "Cerrando…" : "Cerrar caja"}
              </Boton>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
