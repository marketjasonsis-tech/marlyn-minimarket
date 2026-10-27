"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { Insignia } from "@/componentes/Insignia";
import { FormularioNuevoOperador } from "./FormularioNuevoOperador";
import { BotonRestablecerContraseña } from "./BotonRestablecerContraseña";
import type { Usuario } from "../tipos";

import { usuarioParaMostrar } from "../consultas/usuario";

const ETIQUETA_ROL: Record<Usuario["rol"], string> = { dueño: "Dueño", operador: "Colaborador" };

// Activar/desactivar es un update directo a perfiles.activo (no una
// Server Action): es una sola columna sin lógica de auth.admin de por
// medio, y la RLS de Fase 1 (perfiles_dueño_ve_y_administra_todos) ya
// es la barrera real — mismo criterio que el resto de los toggles
// simples del proyecto (PanelListaSimple.tsx).
export function PanelUsuarios({
  usuariosIniciales,
  usuarioActualId,
}: {
  usuariosIniciales: Usuario[];
  usuarioActualId: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pedido de Jason (2026-10-27): un colaborador que ya no trabaja en el
  // local se desactiva, pero seguía apareciendo en la lista. Se esconde
  // (no se borra: sus ventas y movimientos lo siguen nombrando), y se
  // puede volver a ver para reactivarlo.
  const [mostrarDesactivados, setMostrarDesactivados] = useState(false);
  const cantidadDesactivados = usuariosIniciales.filter((usuario) => !usuario.activo).length;
  const usuariosVisibles = mostrarDesactivados
    ? usuariosIniciales
    : usuariosIniciales.filter((usuario) => usuario.activo);

  async function alternarActivo(usuario: Usuario) {
    setError(null);
    setOcupado(usuario.id);
    const supabase = crearClienteNavegador();
    const { error: errorUpdate } = await supabase
      .from("perfiles")
      .update({ activo: !usuario.activo })
      .eq("id", usuario.id);
    setOcupado(null);

    if (errorUpdate) {
      setError(`No se pudo ${usuario.activo ? "desactivar" : "activar"} a ${usuario.nombre}. Probá de nuevo.`);
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {cantidadDesactivados > 0 ? (
          <label className="flex items-center gap-2 text-sm text-texto-suave">
            <input
              type="checkbox"
              checked={mostrarDesactivados}
              onChange={(evento) => setMostrarDesactivados(evento.target.checked)}
              className="h-4 w-4 accent-acento"
            />
            Mostrar desactivados ({cantidadDesactivados})
          </label>
        ) : (
          <span />
        )}
        <FormularioNuevoOperador />
      </div>

      {error && (
        <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">{error}</p>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-base)] border border-linea bg-superficie">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Nombre", "Usuario", "Rol", "Estado", "Acciones"].map((columna) => (
                <th
                  key={columna}
                  className="border-b border-linea px-2.5 py-1.5 text-left font-[family-name:var(--font-numero)] text-[10px] font-medium uppercase tracking-wider text-texto-suave"
                >
                  {columna}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {usuariosVisibles.map((usuario) => {
              const esUsuarioActual = usuario.id === usuarioActualId;
              return (
                <tr key={usuario.id} className="border-b border-linea last:border-b-0">
                  <td className="px-2.5 py-1.5 text-xs font-semibold text-texto">
                    {usuario.nombre}
                    {esUsuarioActual && <span className="ml-1.5 font-normal text-texto-suave">(vos)</span>}
                  </td>
                  <td className="numero px-2.5 py-1.5 text-xs text-texto-suave">
                    {usuarioParaMostrar(usuario.email)}
                  </td>
                  <td className="px-2.5 py-1.5 text-xs text-texto-suave">{ETIQUETA_ROL[usuario.rol]}</td>
                  <td className="px-2.5 py-1.5">
                    <Insignia variante={usuario.activo ? "ok" : "alerta"}>
                      {usuario.activo ? "activo" : "desactivado"}
                    </Insignia>
                  </td>
                  <td className="px-2.5 py-1.5">
                    {esUsuarioActual ? (
                      <span className="text-xs text-texto-suave">—</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={ocupado === usuario.id}
                          onClick={() => alternarActivo(usuario)}
                          className="text-xs text-texto-suave underline decoration-dotted underline-offset-2 hover:text-texto disabled:opacity-50"
                        >
                          {usuario.activo ? "Desactivar" : "Activar"}
                        </button>
                        <BotonRestablecerContraseña usuarioId={usuario.id} nombre={usuario.nombre} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
