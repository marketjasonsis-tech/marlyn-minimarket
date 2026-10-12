import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Cliente } from "../tipos";
import { PanelCuentaCorriente } from "./PanelCuentaCorriente";

// Lo único simulado es lo que sale del navegador: la base acepta todo
// y el historial viene vacío.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/supabase/PerfilContext", () => ({ useEsDueño: () => true }));
vi.mock("@/lib/supabase/cliente", () => ({
  crearClienteNavegador: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
}));
vi.mock("../consultas/clientes", () => ({
  listarMovimientosCuentaCorriente: () => Promise.resolve([]),
}));

function clienteQueDebe(saldoCuentaCorriente: number): Cliente {
  return { id: "cliente-1", nombre: "Juan", telefono: null, direccion: null, saldoCuentaCorriente };
}

async function abrirCuenta(saldo: number) {
  render(<PanelCuentaCorriente cliente={clienteQueDebe(saldo)} turnoCajaId="turno-1" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ver cuenta" }));
  });
}

function monto(): HTMLInputElement {
  return screen.getByLabelText("Monto");
}

describe("PanelCuentaCorriente", () => {
  it("el monto a cobrar se muestra con separador de miles", async () => {
    await abrirCuenta(11102.44);

    expect(monto().value).toBe("11.102,44");
  });

  it("después de aplicar un recargo, el monto sigue con miles y sin decimales de más", async () => {
    // 10093.13 + 1009.31 da 11102.439999999999 en punto flotante.
    await abrirCuenta(10093.13);

    fireEvent.change(screen.getByLabelText("% de recargo"), { target: { value: "10" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    });

    expect(monto().value).toBe("11.102,44");
    fireEvent.focus(monto());
    expect(monto().value).toBe("11102,44");
  });
});
