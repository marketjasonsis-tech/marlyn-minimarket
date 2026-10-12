import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CampoPrecio } from "./CampoPrecio";

describe("CampoPrecio", () => {
  it("un valor con centavos se edita con coma, sin que se pierda el decimal", () => {
    const alCambiar = vi.fn();
    render(<CampoPrecio etiqueta="Monto" id="monto" value="11102.44" onChange={alCambiar} />);
    const campo = screen.getByLabelText<HTMLInputElement>("Monto");

    fireEvent.focus(campo);
    expect(campo.value).toBe("11102,44");

    // Borrar el último dígito: tiene que quedar 11102,4 y no 111024.
    fireEvent.change(campo, { target: { value: campo.value.slice(0, -1) } });
    expect(alCambiar).toHaveBeenLastCalledWith("11102.4");
  });
});
