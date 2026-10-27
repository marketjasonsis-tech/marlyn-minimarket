import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Producto } from "@/modulos/stock/tipos";
import { PanelVentas } from "./PanelVentas";

// Sin tokenPantalla no se abre el canal de la TV, pero el módulo igual
// importa el cliente: que nunca toque la red.
vi.mock("@/lib/supabase/cliente", () => ({ crearClienteNavegador: () => ({}) }));

const jamon: Producto = {
  id: "jamon",
  nombre: "JAMON COCIDO",
  categoriaId: null,
  proveedorId: null,
  codigoBarras: null,
  codigosAdicionales: [],
  precioCosto: null,
  precioVenta: 18000,
  incluyeIva: false,
  porcentajeGanancia: null,
  stockActual: 5,
  stockMinimo: 0,
  unidad: "kg",
  activo: true,
  noComprar: false,
  noComprarMotivo: null,
  noComprarDesde: null,
};

describe("PanelVentas", () => {
  const selectOriginal = HTMLInputElement.prototype.select;

  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    // jsdom no mueve el foco en select(), Chrome sí (verificado en
    // Chrome headless): sin esto el test no ve el salto que ve el cajero.
    HTMLInputElement.prototype.select = function (this: HTMLInputElement) {
      selectOriginal.call(this);
      this.focus();
    };
  });

  afterEach(() => {
    HTMLInputElement.prototype.select = selectOriginal;
    vi.useRealTimers();
  });

  function renderizarPanel() {
    render(
      <PanelVentas
        productos={[jamon]}
        clientes={[]}
        turnoCajaId="turno"
        usuarioId="usuario"
        tokenPantalla=""
        promociones={[]}
        onVentaConfirmada={() => {}}
      />,
    );
  }

  it("a los 2 segundos sin tipear en el buscador, selecciona todo para escribir encima", () => {
    renderizarPanel();
    const buscador = screen.getByPlaceholderText<HTMLInputElement>(/Escaneá/);

    act(() => buscador.focus());
    fireEvent.change(buscador, { target: { value: "jamon" } });
    act(() => vi.advanceTimersByTime(2000));

    expect([buscador.selectionStart, buscador.selectionEnd]).toEqual([0, "jamon".length]);
  });

  it("escribir el monto de un suelto no salta al buscador a los 2 segundos", () => {
    renderizarPanel();

    // Un suelto no tiene código: se busca por nombre y se toca en la grilla.
    fireEvent.change(screen.getByPlaceholderText(/Escaneá/), { target: { value: "jamon" } });
    fireEvent.click(screen.getByRole("button", { name: /JAMON COCIDO/ }));

    const monto = screen.getByLabelText("Monto de JAMON COCIDO");
    act(() => monto.focus());
    act(() => vi.advanceTimersByTime(2000));

    expect(document.activeElement).toBe(monto);
  });
});
