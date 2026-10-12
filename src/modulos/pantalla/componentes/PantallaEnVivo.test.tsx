import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CarritoPantalla } from "../tipos";
import { PantallaEnVivo } from "./PantallaEnVivo";

// Lo único simulado es la red: el token se da por válido y `transmitir`
// hace de terminal de venta mandando un carrito por el canal.
let transmitir: (carrito: CarritoPantalla) => void;

vi.mock("@/lib/supabase/cliente", () => ({
  crearClienteNavegador: () => ({
    rpc: () => Promise.resolve({ data: true, error: null }),
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, alRecibir: (mensaje: { payload: CarritoPantalla }) => void) => {
          transmitir = (carrito) => alRecibir({ payload: carrito });
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => {},
  }),
}));

function carritoDe(nombres: string[]): CarritoPantalla {
  return {
    items: nombres.map((nombre) => ({ productoId: nombre, nombre, cantidad: 1, precioUnitario: 1000 })),
    total: nombres.length * 1000,
  };
}

describe("PantallaEnVivo", () => {
  // jsdom no implementa scrollIntoView (no tiene layout).
  const traerALaVista = vi.fn();

  beforeEach(() => {
    traerALaVista.mockClear();
    Element.prototype.scrollIntoView = traerALaVista;
  });

  it("al escanear un producto nuevo lo trae a la vista: en la TV nadie puede scrollear", async () => {
    render(<PantallaEnVivo token="token-de-prueba" />);
    await act(async () => {});

    act(() => transmitir(carritoDe(["Leche", "Pan"])));
    traerALaVista.mockClear();
    act(() => transmitir(carritoDe(["Leche", "Pan", "Yerba"])));

    expect(traerALaVista).toHaveBeenCalledTimes(1);
    expect(traerALaVista.mock.contexts[0]).toBe(screen.getByText("Yerba").closest("li"));
  });
});
