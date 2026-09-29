import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilaRanking, OrdenRanking, ReportePeriodo, SentidoRanking, VentaReporte } from "../tipos";
import { limitesDelDia } from "./calculos";
import { limitesDelPeriodo, zonaLocal, type Granularidad, type Periodo } from "./periodos";

type FilaVentaReporte = {
  id: string;
  numero: number;
  total: number | string;
  creado_en: string;
  cliente_id: string | null;
  clientes: { nombre: string } | null;
  ventas_items: {
    producto_id: string;
    cantidad: number | string;
    precio_unitario: number | string;
    subtotal: number | string;
    productos: { nombre: string; precio_costo: number | string; activo: boolean } | null;
  }[];
  ventas_pagos: { medio: string; monto: number | string; vuelto: number | string }[];
};

// 'fecha' en formato "YYYY-MM-DD". Solo ventas confirmadas (una anulada
// no debería pesar en ningún indicador del día).
export async function obtenerVentasDelDia(supabase: SupabaseClient, fecha: string): Promise<VentaReporte[]> {
  const { desde, hasta } = limitesDelDia(fecha);

  const { data, error } = await supabase
    .from("ventas")
    .select(
      "id, numero, total, creado_en, cliente_id, clientes(nombre), ventas_items(producto_id, cantidad, precio_unitario, subtotal, productos(nombre, precio_costo, activo)), ventas_pagos(medio, monto, vuelto)",
    )
    .eq("estado", "confirmada")
    .gte("creado_en", desde)
    .lt("creado_en", hasta)
    .order("creado_en", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as unknown as FilaVentaReporte[]).map((fila) => ({
    id: fila.id,
    numero: fila.numero,
    total: Number(fila.total),
    creadoEn: fila.creado_en,
    clienteId: fila.cliente_id,
    clienteNombre: fila.clientes?.nombre ?? null,
    items: fila.ventas_items.map((item) => ({
      productoId: item.producto_id,
      nombre: item.productos?.nombre ?? "Producto eliminado",
      cantidad: Number(item.cantidad),
      precioUnitario: Number(item.precio_unitario),
      subtotal: Number(item.subtotal),
      precioCosto: Number(item.productos?.precio_costo ?? 0),
      eliminado: item.productos === null || !item.productos.activo,
    })),
    pagos: fila.ventas_pagos.map((pago) => ({
      medio: pago.medio,
      monto: Number(pago.monto),
      vuelto: Number(pago.vuelto),
    })),
  }));
}

export async function obtenerReportePeriodo(
  supabase: SupabaseClient,
  periodo: Periodo,
  granularidad: Granularidad,
): Promise<ReportePeriodo> {
  const { desde, hasta } = limitesDelPeriodo(periodo);
  const { data, error } = await supabase.rpc("reporte_periodo", {
    p_desde: desde,
    p_hasta: hasta,
    p_granularidad: granularidad,
    p_zona: zonaLocal(),
  });
  if (error) throw error;

  const fila = data as {
    total: number | string;
    cantidad: number | string;
    margen: number | string;
    serie: { inicio: string; total: number | string }[];
  };
  const total = Number(fila.total);
  const cantidad = Number(fila.cantidad);

  return {
    total,
    cantidad,
    // Sin ventas el ticket promedio es 0, no NaN.
    ticketPromedio: cantidad > 0 ? Math.round((total / cantidad) * 100) / 100 : 0,
    margen: Number(fila.margen),
    serie: fila.serie.map((punto) => ({ inicio: punto.inicio, total: Number(punto.total) })),
  };
}

type FilaRankingBase = {
  producto_id: string;
  nombre: string;
  unidad: FilaRanking["unidad"];
  cantidad: number | string;
  monto: number | string;
  no_comprar: boolean;
  no_comprar_motivo: string | null;
  nuevo: boolean;
};

export async function obtenerRankingProductos(
  supabase: SupabaseClient,
  opciones: { periodo: Periodo; orden: OrdenRanking; sentido: SentidoRanking; limite: number },
): Promise<FilaRanking[]> {
  const { desde, hasta } = limitesDelPeriodo(opciones.periodo);
  const { data, error } = await supabase.rpc("ranking_productos", {
    p_desde: desde,
    p_hasta: hasta,
    p_orden: opciones.orden,
    p_sentido: opciones.sentido,
    p_limite: opciones.limite,
  });
  if (error) throw error;

  return ((data ?? []) as FilaRankingBase[]).map((fila) => ({
    productoId: fila.producto_id,
    nombre: fila.nombre,
    unidad: fila.unidad,
    cantidad: Number(fila.cantidad),
    monto: Number(fila.monto),
    noComprar: fila.no_comprar,
    noComprarMotivo: fila.no_comprar_motivo,
    nuevo: fila.nuevo,
  }));
}
