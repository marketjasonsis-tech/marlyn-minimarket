import type { PuntoSerie } from "../tipos";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const ANCHO = 600;
const ALTO = 180;
const MARGEN = 8;

function coordenadas(serie: PuntoSerie[], maximo: number) {
  // Con un solo punto no hay tramo que dividir: se centra en el ancho.
  const paso = serie.length > 1 ? (ANCHO - 2 * MARGEN) / (serie.length - 1) : 0;
  return serie.map((punto, indice) => ({
    x: serie.length > 1 ? MARGEN + indice * paso : ANCHO / 2,
    y: ALTO - MARGEN - (punto.total / maximo) * (ALTO - 2 * MARGEN),
    punto,
  }));
}

// Línea de la evolución de ventas. `anterior` (opcional) se dibuja
// punteada, alineada por posición: el tramo N del período anterior
// contra el tramo N del actual.
export function GraficoEvolucion({ serie, anterior }: { serie: PuntoSerie[]; anterior?: PuntoSerie[] }) {
  const maximo = Math.max(...serie.map((p) => p.total), ...(anterior ?? []).map((p) => p.total), 1);
  const actuales = coordenadas(serie, maximo);
  const previos = anterior ? coordenadas(anterior, maximo) : [];
  const trazo = (puntos: { x: number; y: number }[]) => puntos.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
      <p className="mb-3 text-sm font-semibold text-texto">Evolución de ventas</p>
      <div className="relative">
        <span className="numero absolute left-0 top-0 text-[10px] text-texto-suave">{platita.format(maximo)}</span>
        <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="h-44 w-full" role="img" aria-label="Evolución de ventas">
          {previos.length > 1 && (
            <polyline
              points={trazo(previos)}
              fill="none"
              stroke="var(--texto-suave)"
              strokeWidth="2"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {actuales.length > 1 && (
            <polyline
              points={trazo(actuales)}
              fill="none"
              stroke="var(--grafico-1)"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {actuales.map(({ x, y, punto }) => (
            <circle key={punto.inicio} cx={x} cy={y} r="3.5" fill="var(--grafico-1)">
              <title>{`${punto.inicio} — ${platita.format(punto.total)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="numero mt-1 flex justify-between text-[10px] text-texto-suave">
        <span>{serie[0]?.inicio}</span>
        <span>{serie[serie.length - 1]?.inicio}</span>
      </div>
    </div>
  );
}
