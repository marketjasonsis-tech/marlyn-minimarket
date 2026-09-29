// @vitest-environment node
//
// Tests de seguridad (prompt-base sección 7, punto 3): la RLS se aplica
// en el motor, no se puede mockear. Patrón: se crea el dato con la clave
// de servicio, se intenta la operación con la clave pública (sin sesión)
// y se verifica que falla, se limpia al final. Corren contra el Supabase
// local (`npx supabase start`), no contra un mock.
//
// Nota: en este proyecto "sin sesión no puede" se cumple en la capa de
// privilegios de Postgres (el rol `anon` no tiene GRANT sobre estas
// tablas, sección "auto_expose_new_tables" de supabase/config.toml) y
// también en la política RLS `..._acceso_perfil_activo`. Ambas fallan con
// SQLSTATE 42501, así que el test no distingue cuál de las dos capas es
// la que efectivamente bloqueó.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const clienteServicio = createClient(url, serviceKey);
const clienteAnonimo = createClient(url, anonKey);

let categoriaId: string;
let productoId: string;
let operadorAuthId: string;
let dueñoAuthId: string;
// Sesiones reales (no la clave de servicio, que no tiene auth.uid() y
// por lo tanto nunca pasa auth_activo()): las necesitan tanto los tests
// de rol como los tests preexistentes de registrar_ajuste_stock que
// antes usaban clienteServicio para simular "cualquier usuario activo".
let clienteOperador: SupabaseClient;
let clienteDueño: SupabaseClient;

beforeAll(async () => {
  const { data: categoria, error: errorCategoria } = await clienteServicio
    .from("categorias")
    .insert({ nombre: "Categoría de prueba RLS" })
    .select("id")
    .single();
  if (errorCategoria || !categoria) throw errorCategoria ?? new Error("No se pudo crear la categoría de prueba");
  categoriaId = categoria.id;

  const { data: producto, error: errorProducto } = await clienteServicio
    .from("productos")
    .insert({ nombre: "Producto de prueba RLS", categoria_id: categoriaId, precio_venta: 100 })
    .select("id")
    .single();
  if (errorProducto || !producto) throw errorProducto ?? new Error("No se pudo crear el producto de prueba");
  productoId = producto.id;

  const password = "prueba-rls-operador-123";

  const emailOperador = `operador-stock-${Date.now()}@marlyn-minimarket.test`;
  const { data: operador, error: errorOperador } = await clienteServicio.auth.admin.createUser({
    email: emailOperador,
    password,
    email_confirm: true,
  });
  if (errorOperador || !operador.user) throw errorOperador ?? new Error("No se pudo crear el operador de prueba");
  operadorAuthId = operador.user.id;

  // El trigger gestionar_usuario_nuevo() crea el perfil con rol 'dueño'
  // por defecto — se pisa para probar justo el otro caso.
  const { error: errorRolOperador } = await clienteServicio
    .from("perfiles")
    .update({ rol: "operador" })
    .eq("id", operadorAuthId);
  if (errorRolOperador) throw errorRolOperador;

  clienteOperador = createClient(url, anonKey);
  const { error: errorLoginOperador } = await clienteOperador.auth.signInWithPassword({
    email: emailOperador,
    password,
  });
  if (errorLoginOperador) throw errorLoginOperador;

  // Segundo usuario de prueba, con el rol 'dueño' por defecto (no hace
  // falta pisarlo) — sirve tanto para el lado "sí puede" de los tests
  // de rol como de sesión activa genérica para los tests viejos.
  const emailDueño = `dueno-stock-${Date.now()}@marlyn-minimarket.test`;
  const { data: dueño, error: errorDueño } = await clienteServicio.auth.admin.createUser({
    email: emailDueño,
    password,
    email_confirm: true,
  });
  if (errorDueño || !dueño.user) throw errorDueño ?? new Error("No se pudo crear el dueño de prueba");
  dueñoAuthId = dueño.user.id;

  clienteDueño = createClient(url, anonKey);
  const { error: errorLoginDueño } = await clienteDueño.auth.signInWithPassword({ email: emailDueño, password });
  if (errorLoginDueño) throw errorLoginDueño;
});

afterAll(async () => {
  // Errores chequeados a propósito, no un await suelto: un delete que
  // falla en silencio por una FK inesperada deja basura de prueba
  // colgada en la base real (pasó de verdad con auditoria/rls.test.ts
  // y con el operador de clientes/rls.test.ts — ver esos commits).
  if (productoId) {
    const { error } = await clienteServicio.from("productos").delete().eq("id", productoId);
    if (error) throw error;
  }
  if (categoriaId) {
    const { error } = await clienteServicio.from("categorias").delete().eq("id", categoriaId);
    if (error) throw error;
  }
  if (operadorAuthId) {
    const { error } = await clienteServicio.auth.admin.deleteUser(operadorAuthId);
    if (error) throw error;
  }
  if (dueñoAuthId) {
    const { error } = await clienteServicio.auth.admin.deleteUser(dueñoAuthId);
    if (error) throw error;
  }
});

describe("RLS de productos y categorías (M1 Stock)", () => {
  it("sin sesión no se puede leer productos", async () => {
    const { data, error } = await clienteAnonimo.from("productos").select("id").eq("id", productoId);

    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("sin sesión no se puede insertar un producto", async () => {
    const { error } = await clienteAnonimo
      .from("productos")
      .insert({ nombre: "Intento sin sesión", precio_venta: 1 });

    expect(error?.code).toBe("42501");
  });

  it("sin sesión no se puede leer categorías", async () => {
    const { data, error } = await clienteAnonimo.from("categorias").select("id").eq("id", categoriaId);

    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });
});

describe("registrar_ingreso_stock (M1 Stock)", () => {
  // A diferencia de las tablas, Postgres otorga EXECUTE a PUBLIC por
  // default en funciones nuevas: acá el rol anon sí llega a ejecutar el
  // cuerpo de la función, pero el chequeo interno de auth_activo() la
  // frena antes de tocar ninguna tabla (mismo patrón que
  // registrar_venta/anular_venta).
  it("sin sesión no se puede ingresar mercadería", async () => {
    const { error } = await clienteAnonimo.rpc("registrar_ingreso_stock", {
      p_producto_id: productoId,
      p_cantidad: 1,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/sesión activa/);
  });
});

describe("Rol operador (Fase 1 de PLAN-ROLES-AUDITORIA.md)", () => {
  it("el operador no ve precio_costo en productos_visibles", async () => {
    const { data, error } = await clienteOperador
      .from("productos_visibles")
      .select("id, precio_costo")
      .eq("id", productoId)
      .single();

    expect(error).toBeNull();
    expect(data?.precio_costo).toBeNull();
  });

  it("el dueño sí ve precio_costo en productos_visibles (no es un apagado global)", async () => {
    const { data, error } = await clienteDueño
      .from("productos_visibles")
      .select("id, precio_costo")
      .eq("id", productoId)
      .single();

    expect(error).toBeNull();
    expect(data?.precio_costo).not.toBeNull();
  });

  it("el operador no puede crear un producto", async () => {
    const { error } = await clienteOperador
      .from("productos")
      .insert({ nombre: "Intento operador", precio_venta: 1 });

    expect(error?.code).toBe("42501");
  });

  it("el operador no puede editar un producto existente", async () => {
    const { error, count } = await clienteOperador
      .from("productos")
      .update({ precio_venta: 999999 }, { count: "exact" })
      .eq("id", productoId);

    // Mismo criterio que notas/rls.test.ts: RLS puede devolver 42501 o
    // simplemente no afectar ninguna fila, según el camino interno.
    expect(error?.code === "42501" || count === 0).toBe(true);
  });

  it("el operador no puede marcar un producto como 'no comprar'", async () => {
    const { error, count } = await clienteOperador
      .from("productos")
      .update(
        { no_comprar: true, no_comprar_motivo: "intento operador", no_comprar_desde: new Date().toISOString() },
        { count: "exact" },
      )
      .eq("id", productoId);

    expect(error?.code === "42501" || count === 0).toBe(true);

    const { data } = await clienteServicio.from("productos").select("no_comprar").eq("id", productoId).single();
    expect(data?.no_comprar).toBe(false);
  });

  it("el dueño puede marcar y desmarcar 'no comprar', y la vista lo expone", async () => {
    const { error } = await clienteDueño
      .from("productos")
      .update({ no_comprar: true, no_comprar_motivo: "se vence rápido", no_comprar_desde: new Date().toISOString() })
      .eq("id", productoId);
    expect(error).toBeNull();

    const { data: marcado } = await clienteDueño
      .from("productos_visibles")
      .select("no_comprar, no_comprar_motivo")
      .eq("id", productoId)
      .single();
    expect(marcado?.no_comprar).toBe(true);
    expect(marcado?.no_comprar_motivo).toBe("se vence rápido");

    const { error: errorQuitar } = await clienteDueño
      .from("productos")
      .update({ no_comprar: false, no_comprar_motivo: null, no_comprar_desde: null })
      .eq("id", productoId);
    expect(errorQuitar).toBeNull();
  });

  it("el operador no puede crear un rubro", async () => {
    const { error } = await clienteOperador.from("categorias").insert({ nombre: "Rubro de operador" });

    expect(error?.code).toBe("42501");
  });
});

describe("registrar_ajuste_stock (M1 Stock)", () => {
  it("sin sesión no se puede ajustar stock", async () => {
    const { error } = await clienteAnonimo.rpc("registrar_ajuste_stock", {
      p_producto_id: productoId,
      p_cantidad: 1,
      p_tipo: "entrada",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/sesión activa/);
  });

  it("una salida no puede dejar el stock en negativo", async () => {
    // clienteServicio no sirve acá: no tiene auth.uid() (no es una
    // sesión de usuario), así que nunca pasa auth_activo() y no llega a
    // esta validación — hace falta una sesión real.
    const { error } = await clienteDueño.rpc("registrar_ajuste_stock", {
      p_producto_id: productoId,
      p_cantidad: 999999,
      p_tipo: "salida",
      p_motivo: "Prueba de RLS",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/no hay stock suficiente/i);
  });

  // Reversa la de arriba: motivo obligatorio en salida se pidió en la
  // Fase 0 de PLAN-ROLES-AUDITORIA.md, y se sacó de nuevo el
  // 2026-09-07 (migración 20260907100000) a pedido explícito del
  // dueño — el detalle de por qué bajó el stock ya no les importa.
  it("una salida sin motivo ya no se rechaza", async () => {
    const { error: errorEntrada } = await clienteDueño.rpc("registrar_ajuste_stock", {
      p_producto_id: productoId,
      p_cantidad: 5,
      p_tipo: "entrada",
    });
    expect(errorEntrada).toBeNull();

    const { error } = await clienteDueño.rpc("registrar_ajuste_stock", {
      p_producto_id: productoId,
      p_cantidad: 1,
      p_tipo: "salida",
    });

    expect(error).toBeNull();
  });
});
