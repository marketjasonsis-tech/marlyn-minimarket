// @vitest-environment node
//
// Las funciones de reportes se ejecutan con los permisos de quien las
// llama y exigen rol dueño: el operador no puede saltarse la UI
// llamándolas directo. Corre contra el Supabase de .env.local.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const clienteServicio = createClient(url, serviceKey);
const clienteAnonimo = createClient(url, anonKey);

const password = "prueba-rls-reportes-123";
let dueñoId: string;
let operadorId: string;
let productoId: string;
let clienteDueño: SupabaseClient;
let clienteOperador: SupabaseClient;

async function crearUsuario(prefijo: string): Promise<{ id: string; cliente: SupabaseClient }> {
  const email = `${prefijo}-${Date.now()}@marlyn-minimarket.test`;
  const { data, error } = await clienteServicio.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("No se pudo crear el usuario de prueba");
  const cliente = createClient(url, anonKey);
  const { error: errorLogin } = await cliente.auth.signInWithPassword({ email, password });
  if (errorLogin) throw errorLogin;
  return { id: data.user.id, cliente };
}

// Rango del año 2000: garantiza cero ventas, sin depender de datos reales.
const DESDE = "2000-01-01T03:00:00.000Z";
const HASTA = "2000-01-08T03:00:00.000Z";
const ZONA = "America/Argentina/Buenos_Aires";

beforeAll(async () => {
  const dueño = await crearUsuario("dueno-reportes");
  dueñoId = dueño.id;
  clienteDueño = dueño.cliente;

  const operador = await crearUsuario("operador-reportes");
  operadorId = operador.id;
  clienteOperador = operador.cliente;
  const { error } = await clienteServicio.from("perfiles").update({ rol: "operador" }).eq("id", operadorId);
  if (error) throw error;

  const { data: producto, error: errorProducto } = await clienteServicio
    .from("productos")
    .insert({ nombre: "AAA producto prueba ranking", precio_venta: 10 })
    .select("id")
    .single();
  if (errorProducto || !producto) throw errorProducto ?? new Error("No se pudo crear el producto de prueba");
  productoId = producto.id;
});

afterAll(async () => {
  if (productoId) {
    const { error } = await clienteServicio.from("productos").delete().eq("id", productoId);
    if (error) throw error;
  }
  for (const id of [dueñoId, operadorId]) {
    if (!id) continue;
    const { error } = await clienteServicio.auth.admin.deleteUser(id);
    if (error) throw error;
  }
});

describe("reporte_periodo", () => {
  it("sin sesión no se puede llamar", async () => {
    const { error } = await clienteAnonimo.rpc("reporte_periodo", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_granularidad: "dia",
      p_zona: ZONA,
    });
    expect(error).not.toBeNull();
  });

  it("el operador no puede llamarla directo", async () => {
    const { error } = await clienteOperador.rpc("reporte_periodo", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_granularidad: "dia",
      p_zona: ZONA,
    });
    expect(error?.message).toMatch(/dueño/);
  });

  it("período sin ventas: todo en cero y un tramo por día, sin huecos", async () => {
    const { data, error } = await clienteDueño.rpc("reporte_periodo", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_granularidad: "dia",
      p_zona: ZONA,
    });
    expect(error).toBeNull();
    expect(Number(data.total)).toBe(0);
    expect(Number(data.cantidad)).toBe(0);
    expect(Number(data.margen)).toBe(0);
    expect(data.serie).toHaveLength(7);
    expect(data.serie[0].inicio).toBe("2000-01-01");
    expect(data.serie[6].inicio).toBe("2000-01-07");
  });

  it("rechaza una granularidad desconocida y un rango invertido", async () => {
    const { error: errorGranularidad } = await clienteDueño.rpc("reporte_periodo", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_granularidad: "siglo",
      p_zona: ZONA,
    });
    expect(errorGranularidad?.message).toMatch(/Granularidad/);

    const { error: errorRango } = await clienteDueño.rpc("reporte_periodo", {
      p_desde: HASTA,
      p_hasta: DESDE,
      p_granularidad: "dia",
      p_zona: ZONA,
    });
    expect(errorRango?.message).toMatch(/inválido/);
  });
});

describe("ranking_productos", () => {
  it("el operador no puede llamarla directo", async () => {
    const { error } = await clienteOperador.rpc("ranking_productos", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_orden: "monto",
      p_sentido: "asc",
      p_limite: 10,
    });
    expect(error?.message).toMatch(/dueño/);
  });

  it("los productos sin ventas entran con cero y marcados como nuevos", async () => {
    const { data, error } = await clienteDueño.rpc("ranking_productos", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_orden: "monto",
      p_sentido: "asc",
      p_limite: 1000,
    });
    expect(error).toBeNull();
    const fila = (data as { producto_id: string; cantidad: number; monto: number; nuevo: boolean }[]).find(
      (item) => item.producto_id === productoId,
    );
    expect(fila).toBeDefined();
    expect(Number(fila!.cantidad)).toBe(0);
    expect(Number(fila!.monto)).toBe(0);
    // Creado ahora, posterior al inicio del rango del año 2000.
    expect(fila!.nuevo).toBe(true);
  });

  it("respeta el límite", async () => {
    const { data } = await clienteDueño.rpc("ranking_productos", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_orden: "cantidad",
      p_sentido: "desc",
      p_limite: 1,
    });
    expect(data).toHaveLength(1);
  });
});

describe("agregados con ventas reales", () => {
  // Un día local de Buenos Aires (UTC-3) en 2001: 03:00Z a 03:00Z del día siguiente.
  const DIA_DESDE = "2001-03-10T03:00:00.000Z";
  const DIA_HASTA = "2001-03-11T03:00:00.000Z";
  let turnoId: string;
  const ventaIds: string[] = [];

  async function crearVenta(total: number, estado: "confirmada" | "anulada", creadoEn: string, cantidad: number) {
    const { data: venta, error } = await clienteServicio
      .from("ventas")
      .insert({
        turno_caja_id: turnoId,
        usuario_id: dueñoId,
        subtotal: total,
        total,
        estado,
        creado_en: creadoEn,
        ...(estado === "anulada" ? { anulada_en: creadoEn, anulada_por: dueñoId, motivo_anulacion: "prueba" } : {}),
      })
      .select("id")
      .single();
    if (error || !venta) throw error ?? new Error("No se pudo crear la venta de prueba");
    ventaIds.push(venta.id);

    const { error: errorItem } = await clienteServicio
      .from("ventas_items")
      .insert({ venta_id: venta.id, producto_id: productoId, cantidad, precio_unitario: total / cantidad, subtotal: total });
    if (errorItem) throw errorItem;
  }

  beforeAll(async () => {
    const { error: errorCosto } = await clienteServicio.from("productos").update({ precio_costo: 40 }).eq("id", productoId);
    if (errorCosto) throw errorCosto;

    const { data: turno, error } = await clienteServicio
      .from("turnos_caja")
      .insert({ usuario_id: dueñoId, estado: "cerrado", cerrado_en: DIA_HASTA })
      .select("id")
      .single();
    if (error || !turno) throw error ?? new Error("No se pudo crear el turno de prueba");
    turnoId = turno.id;

    // 11:00 hora local: cae en el día.
    await crearVenta(300, "confirmada", "2001-03-10T14:00:00.000Z", 2);
    // 23:30 hora local (ya es el día siguiente en UTC): sigue siendo el mismo día local.
    await crearVenta(100, "confirmada", "2001-03-11T02:30:00.000Z", 1);
    // Anulada: no debe contar en nada.
    await crearVenta(999, "anulada", "2001-03-10T15:00:00.000Z", 1);
  });

  afterAll(async () => {
    for (const id of ventaIds) {
      const { error } = await clienteServicio.from("ventas").delete().eq("id", id);
      if (error) throw error;
    }
    if (turnoId) {
      const { error } = await clienteServicio.from("turnos_caja").delete().eq("id", turnoId);
      if (error) throw error;
    }
  });

  it("reporte_periodo suma solo ventas confirmadas, calcula el margen y ubica las de la noche en su día local", async () => {
    const { data, error } = await clienteDueño.rpc("reporte_periodo", {
      p_desde: DIA_DESDE,
      p_hasta: DIA_HASTA,
      p_granularidad: "dia",
      p_zona: ZONA,
    });
    expect(error).toBeNull();
    expect(Number(data.total)).toBe(400);
    expect(Number(data.cantidad)).toBe(2);
    // (300 - 40×2) + (100 - 40×1)
    expect(Number(data.margen)).toBe(280);
    expect(data.serie).toHaveLength(1);
    expect(data.serie[0].inicio).toBe("2001-03-10");
    expect(Number(data.serie[0].total)).toBe(400);
  });

  it("ranking_productos suma cantidad y monto sin contar la venta anulada", async () => {
    const { data, error } = await clienteDueño.rpc("ranking_productos", {
      p_desde: DIA_DESDE,
      p_hasta: DIA_HASTA,
      p_orden: "monto",
      p_sentido: "desc",
      p_limite: 1000,
    });
    expect(error).toBeNull();
    const fila = (data as { producto_id: string; cantidad: number; monto: number }[]).find(
      (item) => item.producto_id === productoId,
    );
    expect(Number(fila!.cantidad)).toBe(3);
    expect(Number(fila!.monto)).toBe(400);
  });
});
