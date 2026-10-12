"use client";

import { useState, type ChangeEvent, type FocusEvent } from "react";
import {
  formatearPrecio,
  limpiarTipeoPrecio,
  textoEdicionDesdeValorCrudo,
  valorCrudoDesdeTipeo,
} from "@/lib/formatoPrecio";

// Reemplaza <input type="number"> para precio de costo y precio de
// venta, a pedido del cliente: quiere ver "1.000" en vez de "1000" (y
// "10.000" para diez mil). Un <input type="number"> nativo no puede
// mostrar eso — el punto se interpretaría como decimal, no como
// separador de miles — así que este es un <input type="text"> que se
// formatea solo.
//
// De paso resuelve el otro problema que reportó para estos mismos
// campos ("de casualidad arrastro y se hacen esos números"): al no ser
// type="number", no tiene flechitas para clickear ni reacciona al
// scroll del mouse — el bug queda eliminado de raíz para precio de
// costo y precio de venta, no solo tapado.
//
// Mientras se edita se muestra el número tal cual se tipeó (sin punto
// de miles), para no pelear con la posición del cursor cada vez que se
// insertaría un punto; el formato con miles aparece al salir del campo.
export function CampoPrecio({
  etiqueta,
  id,
  value,
  onChange,
  placeholder,
  className = "",
  autoFocus,
}: {
  etiqueta: string;
  id: string;
  /** Valor interno: string numérico plano ("1500" o "1500.5"), mismo
   *  formato que ya usan estos campos en el resto del formulario. */
  value: string;
  onChange: (valorCrudo: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [enfocado, setEnfocado] = useState(false);
  // Solo importa mientras `enfocado` es true: desenfocado, se muestra
  // `formatearPrecio(value)` directo (ver el value del <input> más
  // abajo), así que no hace falta mantenerlo sincronizado con `value`
  // todo el tiempo — alcanza con refrescarlo al entrar en foco
  // (alEnfocar) y con cada tecla mientras se edita (alCambiar). Si "%
  // de ganancia" recalcula este precio con el campo desenfocado, el
  // próximo focus ya lo toma actualizado.
  const [textoEnEdicion, setTextoEnEdicion] = useState(value);

  function alEnfocar(evento: FocusEvent<HTMLInputElement>) {
    setEnfocado(true);
    setTextoEnEdicion(textoEdicionDesdeValorCrudo(value));
    evento.currentTarget.select();
  }

  function alDesenfocar() {
    setEnfocado(false);
  }

  function alCambiar(evento: ChangeEvent<HTMLInputElement>) {
    const limpio = limpiarTipeoPrecio(evento.target.value);
    setTextoEnEdicion(limpio);
    onChange(valorCrudoDesdeTipeo(limpio));
  }

  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm">
      <span className="text-texto-suave">{etiqueta}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={enfocado ? textoEnEdicion : formatearPrecio(value)}
        onFocus={alEnfocar}
        onBlur={alDesenfocar}
        onChange={alCambiar}
        autoFocus={autoFocus}
        className={`rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-2 text-texto outline-none focus-visible:border-acento focus-visible:ring-2 focus-visible:ring-acento/40 ${className}`}
      />
    </label>
  );
}
