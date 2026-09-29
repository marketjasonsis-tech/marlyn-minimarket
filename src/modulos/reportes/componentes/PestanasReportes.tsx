"use client";

import { useState, type ReactNode } from "react";
import { PanelPeriodos } from "./PanelPeriodos";

type Pestana = "diario" | "periodos";

const pestanas: { id: Pestana; titulo: string }[] = [
  { id: "diario", titulo: "Diario" },
  { id: "periodos", titulo: "Períodos" },
];

// El diario llega ya armado desde la página (server component); acá solo
// se decide qué pestaña se ve. Las dos quedan montadas para no perder el
// día ni el período elegidos al cambiar de pestaña.
export function PestanasReportes({ diario }: { diario: ReactNode }) {
  const [activa, setActiva] = useState<Pestana>("diario");

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-1 border-b border-linea">
        {pestanas.map((pestana) => (
          <button
            key={pestana.id}
            type="button"
            role="tab"
            aria-selected={activa === pestana.id}
            onClick={() => setActiva(pestana.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              activa === pestana.id
                ? "border-acento text-texto"
                : "border-transparent text-texto-suave hover:text-texto"
            }`}
          >
            {pestana.titulo}
          </button>
        ))}
      </div>

      <div hidden={activa !== "diario"}>{diario}</div>
      <div hidden={activa !== "periodos"}>
        <PanelPeriodos />
      </div>
    </div>
  );
}
