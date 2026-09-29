import { Insignia } from "@/componentes/Insignia";

export function EtiquetaNoComprar({ motivo }: { motivo: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Insignia variante="alerta">no comprar</Insignia>
      {motivo && <span className="text-xs text-alerta">{motivo}</span>}
    </span>
  );
}
