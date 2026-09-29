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
