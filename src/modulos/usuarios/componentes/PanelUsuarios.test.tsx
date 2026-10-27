import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Usuario } from "../tipos";
import { PanelUsuarios } from "./PanelUsuarios";

// Las Server Actions usan la clave de servicio (server-only): acá no se
// llaman, solo hace falta que el módulo se pueda importar.
vi.mock("../consultas/acciones", () => ({ crearOperador: vi.fn(), restablecerContraseña: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/cliente", () => ({ crearClienteNavegador: () => ({}) }));

function usuario(nombre: string, activo: boolean): Usuario {
  return {
    id: nombre,
    nombre,
    email: `${nombre.toLowerCase()}@marlyn.local`,
    rol: "operador",
    activo,
    creadoEn: "2026-09-01T12:00:00Z",
  };
}

describe("PanelUsuarios", () => {
  it("un colaborador que ya no está (desactivado) no aparece en la lista, salvo que se pida verlo", () => {
    render(
      <PanelUsuarios usuariosIniciales={[usuario("Lucia", true), usuario("Martin", false)]} usuarioActualId="otro" />,
    );

    expect(screen.getByText("Lucia")).toBeTruthy();
    expect(screen.queryByText("Martin")).toBeNull();

    fireEvent.click(screen.getByLabelText(/Mostrar desactivados/));

    expect(screen.getByText("Martin")).toBeTruthy();
  });

  it("si no hay nadie desactivado, no muestra la opción", () => {
    render(<PanelUsuarios usuariosIniciales={[usuario("Lucia", true)]} usuarioActualId="otro" />);

    expect(screen.queryByLabelText(/Mostrar desactivados/)).toBeNull();
  });
});
