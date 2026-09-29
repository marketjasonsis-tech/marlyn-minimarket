import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodasLasFilas } from "@/lib/supabase/paginado";
import type { Categoria, Producto } from "../tipos";

type FilaProducto = {
  id: string;
  nombre: string;
  categoria_id: string | null;
  proveedor_id: string | null;
  codigo_barras: string | null;
  codigos_adicionales: string[] | null;
  precio_costo: number | string | null;
  precio_venta: number | string;
  incluye_iva: boolean;
  porcentaje_ganancia: number | string | null;
  stock_actual: number | string;
  stock_minimo: number | string;
  unidad: Producto["unidad"];
  activo: boolean;
  no_comprar: boolean;
  no_comprar_motivo: string | null;
  no_comprar_desde: string | null;
};

// Lee de productos_visibles (vista, no la tabla): igual que productos,
// salvo que precio_costo viaja null si quien consulta no es dueño —
// esa es la barrera real (Fase 1 de PLAN-ROLES-AUDITORIA.md), acá solo
// hace falta no pisarlo con 0 al mapear.
//
// Recibe cualquier cliente de Supabase (servidor o navegador): el server
// component la usa para la carga inicial, el formulario de alta la
// reusaría para un refresco optimista si hiciera falta más adelante.
export async function listarProductos(supabase: SupabaseClient): Promise<Producto[]> {
  const data = await traerTodasLasFilas<FilaProducto>(
    supabase,
    "productos_visibles",
    "id, nombre, categoria_id, proveedor_id, codigo_barras, codigos_adicionales, precio_costo, precio_venta, incluye_iva, porcentaje_ganancia, stock_actual, stock_minimo, unidad, activo, no_comprar, no_comprar_motivo, no_comprar_desde",
    [
      { columna: "creado_en", ascendente: false },
      { columna: "id", ascendente: true },
    ],
  );

  return data.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    categoriaId: fila.categoria_id,
    proveedorId: fila.proveedor_id,
    codigoBarras: fila.codigo_barras,
    codigosAdicionales: fila.codigos_adicionales ?? [],
    precioCosto: fila.precio_costo === null ? null : Number(fila.precio_costo),
    precioVenta: Number(fila.precio_venta),
    incluyeIva: fila.incluye_iva,
    porcentajeGanancia: fila.porcentaje_ganancia === null ? null : Number(fila.porcentaje_ganancia),
    stockActual: Number(fila.stock_actual),
    stockMinimo: Number(fila.stock_minimo),
    unidad: fila.unidad,
    activo: fila.activo,
    noComprar: fila.no_comprar,
    noComprarMotivo: fila.no_comprar_motivo,
    noComprarDesde: fila.no_comprar_desde,
  }));
}

export async function listarCategorias(supabase: SupabaseClient): Promise<Categoria[]> {
  const { data, error } = await supabase
    .from("categorias")
    .select("id, nombre")
    .order("nombre", { ascending: true });

  if (error) throw error;

  return (data ?? []) as Categoria[];
}
