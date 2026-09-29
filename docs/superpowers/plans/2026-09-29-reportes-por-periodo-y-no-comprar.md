# Reportes por período y "no comprar más" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sumar a Reportes una pestaña "Períodos" (ventas y ranking de productos por rango de fechas, con comparación) y una lista de productos "no comprar más" que avisa al armar pedidos.

**Architecture:** Los agregados de reportes se calculan en Postgres (dos funciones `security invoker`, solo dueño) para no chocar con el tope de 1000 filas de Supabase. La lógica de fechas (atajos, período anterior, granularidad, variación %) vive en funciones puras testeadas con Vitest. "No comprar" son tres columnas nuevas en `productos` (la RLS ya limita la escritura al dueño) expuestas por la vista `productos_visibles`.

**Tech Stack:** Next.js 16 (App Router) + React 19, Supabase (Postgres + RLS), Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-reportes-por-periodo-y-no-comprar-design.md`

## Global Constraints

- Antes de escribir componentes/páginas nuevas de Next, hojear la guía relevante en `node_modules/next/dist/docs/` (AGENTS.md: esta versión tiene cambios de API).
- Idioma de la UI: español rioplatense con voseo ("Elegí", "Probá", "Quitar"). Identificadores en español, igual que el resto del código.
- Colores solo con tokens de `src/estilos/tema.css` (`bg-superficie`, `border-linea`, `text-texto-suave`, `var(--grafico-1)`…). Nada de colores literales fuera de ese archivo.
- El dashboard diario (`PanelReportes`) NO se modifica: solo se envuelve en una pestaña.
- Solo cuentan ventas `estado = 'confirmada'`. El Balance usa el `precio_costo` ACTUAL (igual que el diario).
- Horarios: se usa la zona horaria del navegador (mismo criterio que `limitesDelDia`); se le pasa a SQL como `p_zona`.
- Commits **sin** trailer `Co-Authored-By` (regla del dueño del repo, pisa la de Claude Code). Mensajes en español, en modo imperativo ("Agregar…").
- Los `*rls.test.ts` pegan contra el Supabase de `.env.local`; requieren aplicar las migraciones antes. **Aplicar migraciones a la base hosteada (`supabase db push`) es una acción sobre datos reales: pedir confirmación a Enzo antes de correrla.**

## Review Focus

- Período de un solo día (`inicio == fin`): granularidad `dia`, gráfico con 1 punto sin dividir por cero. → Task 4 (test) y Task 6.
- Período sin ventas: total 0, ticket promedio 0 (no NaN), variación `null` mostrada como "—". → Task 4 (test) y Task 5 (test RLS con rango vacío).
- "Personalizado" con inicio posterior al fin (o vacío): no se consulta, se muestra un mensaje. → Task 4 (`periodoValido`) y Task 6.
- Producto marcado "no comprar" pero desactivado/eliminado: no aparece en la lista ni molesta en pedidos. → Task 2 (test `productosNoComprar`).
- Motivo escrito solo con espacios se guarda como `null`; editar un producto ya marcado no le reinicia la fecha. → Task 2 (tests).
- El operador llama directo a `reporte_periodo`/`ranking_productos` (saltando la UI): la base lo rechaza. El operador no puede marcar `no_comprar`. → Task 1 y Task 5 (tests RLS).

---

### Task 1: Columnas `no_comprar` en la base, tipos y lectura

**Files:**
- Create: `supabase/migrations/20260929100000_no_comprar.sql`
- Modify: `src/modulos/stock/tipos.ts`
- Modify: `src/modulos/stock/consultas/productos.ts`
- Modify: `src/modulos/stock/rls.test.ts` (dos tests nuevos en el `describe("Rol operador …")`)
- Modify: cualquier fixture/test que arme un `Producto` a mano (los encuentra `npm run typecheck`)

**Interfaces:**
- Produces: `Producto.noComprar: boolean`, `Producto.noComprarMotivo: string | null`, `Producto.noComprarDesde: string | null` (ISO). La vista `productos_visibles` expone `no_comprar`, `no_comprar_motivo`, `no_comprar_desde`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/20260929100000_no_comprar.sql`:

```sql
-- "No comprar más": productos que el dueño decidió no volver a pedir
-- (malos, con problemas), con el motivo, para que no se olviden. La
-- escritura ya es solo del dueño por productos_update_dueño (RLS del
-- 20260818120000), así que no hace falta una policy nueva.
alter table public.productos
  add column no_comprar boolean not null default false,
  add column no_comprar_motivo text,
  add column no_comprar_desde timestamptz;

alter table public.productos
  add constraint productos_no_comprar_coherente
  check (no_comprar or (no_comprar_motivo is null and no_comprar_desde is null));

-- La vista se recrea con las columnas nuevas (misma definición que
-- 20260902110000_codigos_barras_adicionales.sql + las tres nuevas).
drop view public.productos_visibles;

create view public.productos_visibles
with (security_invoker = true)
as
select
  p.id,
  p.nombre,
  p.categoria_id,
  p.proveedor_id,
  p.codigo_barras,
  coalesce(
    (select array_agg(c.codigo order by c.creado_en, c.codigo)
     from public.productos_codigos_barras c
     where c.producto_id = p.id),
    '{}'::text[]
  ) as codigos_adicionales,
  case when coalesce(public.auth_rol(), '') = 'dueño' then p.precio_costo else null end as precio_costo,
  p.precio_venta,
  p.incluye_iva,
  p.porcentaje_ganancia,
  p.stock_actual,
  p.stock_minimo,
  p.unidad,
  p.activo,
  p.creado_en,
  p.actualizado_en,
  p.no_comprar,
  p.no_comprar_motivo,
  p.no_comprar_desde
from public.productos p;

grant select on public.productos_visibles to authenticated;
```

- [ ] **Step 2: Escribir los tests RLS que fallan**

En `src/modulos/stock/rls.test.ts`, dentro del `describe("Rol operador (Fase 1 de PLAN-ROLES-AUDITORIA.md)", …)`, agregar al final:

```ts
  it("el operador no puede marcar un producto como 'no comprar'", async () => {
    const { error, count } = await clienteOperador
      .from("productos")
      .update({ no_comprar: true, no_comprar_motivo: "intento operador", no_comprar_desde: new Date().toISOString() }, { count: "exact" })
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
```

- [ ] **Step 3: Correr el test y ver que falla**

Run: `npx vitest run src/modulos/stock/rls.test.ts -t "no comprar"`
Expected: FAIL (`column "no_comprar" does not exist`), porque la migración todavía no está aplicada.

- [ ] **Step 4: Aplicar la migración (pedir OK a Enzo primero)**

Local con Docker: `npx supabase db reset`. Hosteado: `npx supabase db push`.
Run de nuevo: `npx vitest run src/modulos/stock/rls.test.ts`
Expected: PASS (todo el archivo).

- [ ] **Step 5: Tipos y lectura**

`src/modulos/stock/tipos.ts`: en `Producto`, después de `activo: boolean;` agregar:

```ts
  /** El dueño decidió no volver a comprarlo (ver PENDIENTES/README:
   *  "No comprar más"). Se avisa en pedidos y alertas de stock; nunca
   *  bloquea nada. */
  noComprar: boolean;
  noComprarMotivo: string | null;
  /** ISO. null si no está marcado. */
  noComprarDesde: string | null;
```

`src/modulos/stock/consultas/productos.ts`: en `FilaProducto` agregar tras `activo: boolean;`:

```ts
  no_comprar: boolean;
  no_comprar_motivo: string | null;
  no_comprar_desde: string | null;
```

En el string del `select`, cambiar `…, unidad, activo",` por `…, unidad, activo, no_comprar, no_comprar_motivo, no_comprar_desde",` y en el `map` agregar tras `activo: fila.activo,`:

```ts
    noComprar: fila.no_comprar,
    noComprarMotivo: fila.no_comprar_motivo,
    noComprarDesde: fila.no_comprar_desde,
```

- [ ] **Step 6: Arreglar lo que rompa el typecheck**

Run: `npm run typecheck`
Expected: errores de "Property 'noComprar' is missing" en tests/fixtures que construyen un `Producto`. En cada uno agregar `noComprar: false, noComprarMotivo: null, noComprarDesde: null,`. Repetir hasta que `npm run typecheck` pase sin errores.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929100000_no_comprar.sql src/modulos/stock
git commit -m "Agregar columnas no_comprar a productos y exponerlas en la vista"
```

---

### Task 2: Lógica y botón para marcar "no comprar"

**Files:**
- Create: `src/modulos/stock/consultas/noComprar.ts`
- Create: `src/modulos/stock/consultas/noComprar.test.ts`
- Create: `src/modulos/stock/componentes/BotonNoComprar.tsx`
- Modify: `src/modulos/stock/componentes/FormularioEditarProducto.tsx` (estado, payload del update y UI)

**Interfaces:**
- Consumes: `Producto` de Task 1.
- Produces:
  - `limpiarMotivo(texto: string): string | null`
  - `datosNoComprar(marcar: boolean, motivo: string, desdeActual?: string | null, ahora?: Date): { no_comprar: boolean; no_comprar_motivo: string | null; no_comprar_desde: string | null }`
  - `productosNoComprar(productos: Producto[]): Producto[]`
  - `guardarNoComprar(supabase: SupabaseClient, productoId: string, marcar: boolean, motivo: string): Promise<void>`
  - `<BotonNoComprar producto={{ id, nombre, noComprar }} onCambio?={() => void} />` (solo dueño; hace `router.refresh()`).

- [ ] **Step 1: Escribir los tests que fallan**

`src/modulos/stock/consultas/noComprar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Producto } from "../tipos";
import { datosNoComprar, limpiarMotivo, productosNoComprar } from "./noComprar";

function producto(datos: Partial<Producto>): Producto {
  return {
    id: "p1",
    nombre: "Producto",
    categoriaId: null,
    proveedorId: null,
    codigoBarras: null,
    codigosAdicionales: [],
    precioCosto: 10,
    precioVenta: 20,
    incluyeIva: false,
    porcentajeGanancia: null,
    stockActual: 0,
    stockMinimo: 0,
    unidad: "unidad",
    activo: true,
    noComprar: false,
    noComprarMotivo: null,
    noComprarDesde: null,
    ...datos,
  };
}

describe("limpiarMotivo", () => {
  it("un motivo de solo espacios se guarda como null", () => {
    expect(limpiarMotivo("   ")).toBeNull();
    expect(limpiarMotivo("")).toBeNull();
  });

  it("recorta los espacios de los costados", () => {
    expect(limpiarMotivo("  se vence rápido ")).toBe("se vence rápido");
  });
});

describe("datosNoComprar", () => {
  const ahora = new Date("2026-09-29T15:00:00.000Z");

  it("al marcar guarda motivo limpio y la fecha de ahora", () => {
    expect(datosNoComprar(true, " mala calidad ", null, ahora)).toEqual({
      no_comprar: true,
      no_comprar_motivo: "mala calidad",
      no_comprar_desde: "2026-09-29T15:00:00.000Z",
    });
  });

  it("si ya estaba marcado, conserva la fecha original al editar el motivo", () => {
    const datos = datosNoComprar(true, "otro motivo", "2026-01-10T12:00:00.000Z", ahora);
    expect(datos.no_comprar_desde).toBe("2026-01-10T12:00:00.000Z");
    expect(datos.no_comprar_motivo).toBe("otro motivo");
  });

  it("al desmarcar limpia motivo y fecha (lo exige el check de la base)", () => {
    expect(datosNoComprar(false, "lo que sea", "2026-01-10T12:00:00.000Z", ahora)).toEqual({
      no_comprar: false,
      no_comprar_motivo: null,
      no_comprar_desde: null,
    });
  });
});

describe("productosNoComprar", () => {
  it("lista solo los marcados y activos, ordenados por nombre", () => {
    const lista = productosNoComprar([
      producto({ id: "1", nombre: "Zeta", noComprar: true }),
      producto({ id: "2", nombre: "Alfa", noComprar: true }),
      producto({ id: "3", nombre: "Normal", noComprar: false }),
      producto({ id: "4", nombre: "Eliminado", noComprar: true, activo: false }),
    ]);
    expect(lista.map((p) => p.nombre)).toEqual(["Alfa", "Zeta"]);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/modulos/stock/consultas/noComprar.test.ts`
Expected: FAIL ("Cannot find module './noComprar'").

- [ ] **Step 3: Implementar**

`src/modulos/stock/consultas/noComprar.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Producto } from "../tipos";

/** Funciones puras + un update: la lista "no comprar más" es solo una
 *  marca en el producto (ver el spec 2026-09-29). */

export function limpiarMotivo(texto: string): string | null {
  const limpio = texto.trim();
  return limpio === "" ? null : limpio;
}

// Al desmarcar hay que limpiar motivo y fecha: la tabla tiene un check
// (productos_no_comprar_coherente) que no deja motivo/fecha sueltos.
// Si ya estaba marcado, `desdeActual` conserva la fecha original al
// editar solo el motivo.
export function datosNoComprar(
  marcar: boolean,
  motivo: string,
  desdeActual: string | null = null,
  ahora: Date = new Date(),
) {
  if (!marcar) return { no_comprar: false, no_comprar_motivo: null, no_comprar_desde: null };
  return {
    no_comprar: true,
    no_comprar_motivo: limpiarMotivo(motivo),
    no_comprar_desde: desdeActual ?? ahora.toISOString(),
  };
}

// Un producto eliminado (activo = false) ya no se puede pedir ni
// vender, así que no ensucia la lista.
export function productosNoComprar(productos: Producto[]): Producto[] {
  return productos
    .filter((producto) => producto.activo && producto.noComprar)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function guardarNoComprar(
  supabase: SupabaseClient,
  productoId: string,
  marcar: boolean,
  motivo: string,
): Promise<void> {
  const { error } = await supabase.from("productos").update(datosNoComprar(marcar, motivo)).eq("id", productoId);
  if (error) throw error;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/modulos/stock/consultas/noComprar.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Componente `BotonNoComprar`**

`src/modulos/stock/componentes/BotonNoComprar.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/componentes/Boton";
import { Campo } from "@/componentes/Campo";
import { Modal } from "@/componentes/Modal";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { useEsDueño } from "@/lib/supabase/PerfilContext";
import { guardarNoComprar } from "../consultas/noComprar";

const clasesEnlace =
  "text-xs font-medium text-texto-suave underline decoration-dotted underline-offset-2 hover:text-texto disabled:opacity-50";

// Solo el dueño lo ve (la barrera real es la RLS de productos; esto
// evita mostrar un botón que no va a hacer nada). Si el producto ya
// está marcado ofrece quitarlo; si no, pide un motivo opcional.
export function BotonNoComprar({
  producto,
  onCambio,
}: {
  producto: { id: string; nombre: string; noComprar: boolean };
  onCambio?: () => void;
}) {
  const esDueño = useEsDueño();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!esDueño) return null;

  async function aplicar(marcar: boolean) {
    setGuardando(true);
    setError(null);
    try {
      await guardarNoComprar(crearClienteNavegador(), producto.id, marcar, motivo);
      setAbierto(false);
      setMotivo("");
      router.refresh();
      onCambio?.();
    } catch {
      setError("No se pudo guardar. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  if (producto.noComprar) {
    return (
      <>
        <button type="button" disabled={guardando} onClick={() => aplicar(false)} className={clasesEnlace}>
          Quitar de &ldquo;no comprar&rdquo;
        </button>
        {error && <span className="text-xs text-alerta">{error}</span>}
      </>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={clasesEnlace}>
        No comprar más
      </button>

      <Modal titulo="No comprar más" abierto={abierto} onCerrar={() => setAbierto(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-texto">
            <strong>{producto.nombre}</strong> va a aparecer con un aviso rojo cuando armes un pedido.
          </p>
          <Campo
            etiqueta="Motivo (opcional)"
            id={`motivoNoComprar-${producto.id}`}
            placeholder="Ej: se vence rápido, mala calidad"
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
          />
          {error && (
            <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="button" variante="peligro" disabled={guardando} onClick={() => aplicar(true)}>
              {guardando ? "Guardando…" : "Marcar"}
            </Boton>
          </div>
        </div>
      </Modal>
    </>
  );
}
```

- [ ] **Step 6: Interruptor + motivo en Editar producto**

En `src/modulos/stock/componentes/FormularioEditarProducto.tsx`:

1. Import: `import { datosNoComprar } from "../consultas/noComprar";`
2. En `estadoDesdeProducto`, después de `unidad: producto.unidad,` agregar:
```ts
    noComprar: producto.noComprar,
    motivoNoComprar: producto.noComprarMotivo ?? "",
```
3. En el `.update({ … })`, después de `unidad: campos.unidad,` agregar:
```ts
          ...datosNoComprar(campos.noComprar, campos.motivoNoComprar, producto.noComprarDesde),
```
4. En el JSX, justo antes del bloque `{errorGeneral && (`, agregar:
```tsx
          <div className="flex flex-col gap-2 rounded-[var(--radius-base)] border border-linea p-3">
            <label htmlFor={`noComprar-${producto.id}`} className="flex items-center gap-2 text-sm text-texto">
              <input
                type="checkbox"
                id={`noComprar-${producto.id}`}
                checked={campos.noComprar}
                onChange={(evento) => setCampos({ ...campos, noComprar: evento.target.checked })}
                className="h-4 w-4 accent-acento"
              />
              No comprar más este producto
            </label>
            {campos.noComprar && (
              <Campo
                etiqueta="Motivo (opcional)"
                id={`motivoNoComprarEdicion-${producto.id}`}
                placeholder="Ej: se vence rápido, mala calidad"
                value={campos.motivoNoComprar}
                onChange={(evento) => setCampos({ ...campos, motivoNoComprar: evento.target.value })}
              />
            )}
          </div>
```

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint && npx vitest run src/modulos/stock/consultas`
Expected: sin errores, tests en verde.

- [ ] **Step 8: Commit**

```bash
git add src/modulos/stock
git commit -m "Marcar productos como no comprar más desde Stock"
```

---

### Task 3: Avisos en pedidos y alertas + listado en Proveedores

**Files:**
- Create: `src/modulos/stock/componentes/EtiquetaNoComprar.tsx`
- Create: `src/modulos/proveedores/componentes/PanelNoComprar.tsx`
- Modify: `src/modulos/proveedores/componentes/PanelPedidoProveedor.tsx`
- Modify: `src/modulos/reportes/componentes/PanelAlertasStock.tsx`
- Modify: `src/app/(app)/proveedores/page.tsx`

**Interfaces:**
- Consumes: `Producto.noComprar/noComprarMotivo/noComprarDesde` (Task 1); `productosNoComprar`, `<BotonNoComprar>` (Task 2).
- Produces: `<EtiquetaNoComprar motivo={string | null} />`, `<PanelNoComprar productos={Producto[]} proveedores={Proveedor[]} />`.

- [ ] **Step 1: Etiqueta**

`src/modulos/stock/componentes/EtiquetaNoComprar.tsx`:

```tsx
import { Insignia } from "@/componentes/Insignia";

export function EtiquetaNoComprar({ motivo }: { motivo: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Insignia variante="alerta">no comprar</Insignia>
      {motivo && <span className="text-xs text-alerta">{motivo}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Aviso en `PanelPedidoProveedor`**

Import: `import { EtiquetaNoComprar } from "@/modulos/stock/componentes/EtiquetaNoComprar";`

Antes del `return`, junto a los demás hooks, agregar:

```tsx
  const marcadosElegidos = productosDelProveedor.filter(
    (producto) => seleccionados[producto.id] && producto.noComprar,
  );
```

En el `<label …>` de cada producto, después del `<span className="numero ml-1.5 …">…</span>`, agregar:

```tsx
                      {producto.noComprar && (
                        <span className="ml-2">
                          <EtiquetaNoComprar motivo={producto.noComprarMotivo} />
                        </span>
                      )}
```

Entre el `</ul>` y `<Boton type="button" onClick={generarPedido}>`, agregar:

```tsx
              {marcadosElegidos.length > 0 && (
                <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">
                  Ojo: {marcadosElegidos.map((producto) => producto.nombre).join(", ")} está en la lista de
                  &ldquo;no comprar más&rdquo;. Revisá antes de pedirlo.
                </p>
              )}
```

- [ ] **Step 3: Etiqueta en `PanelAlertasStock`**

Import: `import { EtiquetaNoComprar } from "@/modulos/stock/componentes/EtiquetaNoComprar";`

Reemplazar `<span className="text-texto">{producto.nombre}</span>` por:

```tsx
                <span className="flex flex-col gap-0.5 text-texto">
                  {producto.nombre}
                  {producto.noComprar && <EtiquetaNoComprar motivo={producto.noComprarMotivo} />}
                </span>
```

- [ ] **Step 4: Listado `PanelNoComprar`**

`src/modulos/proveedores/componentes/PanelNoComprar.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { BotonNoComprar } from "@/modulos/stock/componentes/BotonNoComprar";
import { productosNoComprar } from "@/modulos/stock/consultas/noComprar";
import type { Producto } from "@/modulos/stock/tipos";
import type { Proveedor } from "../tipos";

const columnas = ["Producto", "Proveedor", "Motivo", "Desde", ""];

export function PanelNoComprar({ productos, proveedores }: { productos: Producto[]; proveedores: Proveedor[] }) {
  const lista = useMemo(() => productosNoComprar(productos), [productos]);
  const nombreProveedor = useMemo(
    () => new Map(proveedores.map((proveedor) => [proveedor.id, proveedor.nombre])),
    [proveedores],
  );

  return (
    <section className="mt-6 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-texto">No comprar más</h2>
        <p className="text-xs text-texto-suave">
          Productos que decidieron no volver a pedir. Aparecen con aviso al armar un pedido.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-base)] border border-linea bg-superficie">
        {lista.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-texto-suave">Todavía no marcaron ningún producto.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {columnas.map((columna, indice) => (
                  <th
                    key={indice}
                    className="border-b border-linea px-2.5 py-1.5 text-left font-[family-name:var(--font-numero)] text-[10px] font-medium uppercase tracking-wider text-texto-suave"
                  >
                    {columna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((producto) => (
                <tr key={producto.id} className="border-b border-linea last:border-b-0">
                  <td className="px-2.5 py-1.5 text-xs font-semibold text-texto">{producto.nombre}</td>
                  <td className="px-2.5 py-1.5 text-xs text-texto-suave">
                    {(producto.proveedorId && nombreProveedor.get(producto.proveedorId)) ?? "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-xs text-texto-suave">{producto.noComprarMotivo ?? "—"}</td>
                  <td className="numero px-2.5 py-1.5 text-xs text-texto-suave">
                    {producto.noComprarDesde ? new Date(producto.noComprarDesde).toLocaleDateString("es-AR") : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <BotonNoComprar producto={producto} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Mostrarlo en la página de Proveedores**

En `src/app/(app)/proveedores/page.tsx` agregar el import
`import { PanelNoComprar } from "@/modulos/proveedores/componentes/PanelNoComprar";`
y, dentro de `<main …>`, después del bloque condicional `{proveedores.length === 0 ? … : …}`, agregar:

```tsx
        <PanelNoComprar productos={productos} proveedores={proveedores} />
```

- [ ] **Step 6: Verificar en la app**

Run: `npm run typecheck && npm run lint`
Luego `npm run dev` y, como dueño: (a) en Stock → Editar un producto, tildar "No comprar más" con motivo, guardar; (b) en Proveedores: el producto aparece en "No comprar más" con motivo y fecha, y con la etiqueta roja dentro de "Productos y pedido" del proveedor, con el aviso al tildarlo; (c) "Quitar" lo saca de la lista; (d) en Reportes → Diario, si el producto está bajo el mínimo, se ve la etiqueta en Alertas de stock.
Expected: todo coincide. Si algo no se puede probar en el navegador, decirlo explícitamente en el reporte.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "Avisar productos no comprar más en pedidos y alertas, con listado en Proveedores"
```

---

### Task 4: Lógica pura de períodos

**Files:**
- Create: `src/modulos/reportes/consultas/periodos.ts`
- Create: `src/modulos/reportes/consultas/periodos.test.ts`

**Interfaces:**
- Consumes: `hoyISO`, `limitesDelDia` de `./calculos`.
- Produces:
  - `type AtajoPeriodo = "7d" | "30d" | "mes_actual" | "mes_pasado" | "6m" | "1a" | "personalizado"`
  - `type Granularidad = "dia" | "semana" | "mes"`
  - `type Periodo = { inicio: string; fin: string }` (YYYY-MM-DD, ambos inclusive)
  - `sumarDias(iso: string, dias: number): string`
  - `diasDelPeriodo(periodo: Periodo): number`
  - `periodoDeAtajo(atajo: AtajoPeriodo, hoy: string): Periodo | null` (`null` para "personalizado")
  - `periodoAnterior(periodo: Periodo): Periodo`
  - `elegirGranularidad(periodo: Periodo): Granularidad`
  - `limitesDelPeriodo(periodo: Periodo): { desde: string; hasta: string }`
  - `variacionPorcentual(actual: number, anterior: number): number | null`
  - `periodoValido(periodo: Periodo): boolean`
  - `zonaLocal(): string`

- [ ] **Step 1: Escribir los tests que fallan**

`src/modulos/reportes/consultas/periodos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  diasDelPeriodo,
  elegirGranularidad,
  limitesDelPeriodo,
  periodoAnterior,
  periodoDeAtajo,
  periodoValido,
  sumarDias,
  variacionPorcentual,
} from "./periodos";

const HOY = "2026-09-29";

describe("sumarDias", () => {
  it("cruza fin de mes y de año", () => {
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("diasDelPeriodo", () => {
  it("cuenta ambos extremos", () => {
    expect(diasDelPeriodo({ inicio: "2026-09-23", fin: "2026-09-29" })).toBe(7);
    expect(diasDelPeriodo({ inicio: "2026-09-29", fin: "2026-09-29" })).toBe(1);
  });
});

describe("periodoDeAtajo", () => {
  it("últimos 7 y 30 días incluyen hoy", () => {
    expect(periodoDeAtajo("7d", HOY)).toEqual({ inicio: "2026-09-23", fin: HOY });
    expect(periodoDeAtajo("30d", HOY)).toEqual({ inicio: "2026-08-31", fin: HOY });
  });

  it("este mes va del 1 a hoy; mes pasado es el mes completo anterior", () => {
    expect(periodoDeAtajo("mes_actual", HOY)).toEqual({ inicio: "2026-09-01", fin: HOY });
    expect(periodoDeAtajo("mes_pasado", HOY)).toEqual({ inicio: "2026-08-01", fin: "2026-08-31" });
  });

  it("mes pasado en enero cruza al año anterior", () => {
    expect(periodoDeAtajo("mes_pasado", "2026-01-15")).toEqual({ inicio: "2025-12-01", fin: "2025-12-31" });
  });

  it("últimos 6 meses y último año arrancan el día 1 del mes correspondiente", () => {
    expect(periodoDeAtajo("6m", HOY)).toEqual({ inicio: "2026-04-01", fin: HOY });
    expect(periodoDeAtajo("1a", HOY)).toEqual({ inicio: "2025-10-01", fin: HOY });
  });

  it("personalizado no define fechas", () => {
    expect(periodoDeAtajo("personalizado", HOY)).toBeNull();
  });
});

describe("periodoAnterior", () => {
  it("tiene el mismo largo y termina el día antes del inicio", () => {
    expect(periodoAnterior({ inicio: "2026-09-23", fin: "2026-09-29" })).toEqual({
      inicio: "2026-09-16",
      fin: "2026-09-22",
    });
    expect(periodoAnterior({ inicio: "2026-08-01", fin: "2026-08-31" })).toEqual({
      inicio: "2026-07-01",
      fin: "2026-07-31",
    });
  });

  it("un solo día compara contra el día anterior", () => {
    expect(periodoAnterior({ inicio: HOY, fin: HOY })).toEqual({ inicio: "2026-09-28", fin: "2026-09-28" });
  });
});

describe("elegirGranularidad", () => {
  const desde = "2026-01-01";
  const conDias = (dias: number) => ({ inicio: desde, fin: sumarDias(desde, dias - 1) });

  it("un solo día es por día", () => {
    expect(elegirGranularidad(conDias(1))).toBe("dia");
  });

  it("hasta 31 días es por día, hasta 200 por semana, más por mes", () => {
    expect(elegirGranularidad(conDias(31))).toBe("dia");
    expect(elegirGranularidad(conDias(32))).toBe("semana");
    expect(elegirGranularidad(conDias(200))).toBe("semana");
    expect(elegirGranularidad(conDias(201))).toBe("mes");
  });
});

describe("limitesDelPeriodo", () => {
  it("va de la medianoche del inicio a la medianoche posterior al fin", () => {
    const { desde, hasta } = limitesDelPeriodo({ inicio: "2026-09-28", fin: "2026-09-29" });
    expect(new Date(hasta).getTime() - new Date(desde).getTime()).toBe(2 * 24 * 60 * 60 * 1000);
    expect(new Date(desde).getHours()).toBe(0);
  });
});

describe("variacionPorcentual", () => {
  it("da el % de cambio con dos decimales", () => {
    expect(variacionPorcentual(3484379.96, 2744574.56)).toBe(26.96);
    expect(variacionPorcentual(50, 100)).toBe(-50);
  });

  it("sin base de comparación (anterior 0) da null, no infinito ni NaN", () => {
    expect(variacionPorcentual(100, 0)).toBeNull();
    expect(variacionPorcentual(0, 0)).toBeNull();
  });
});

describe("periodoValido", () => {
  it("rechaza vacío o inicio posterior al fin", () => {
    expect(periodoValido({ inicio: "", fin: "2026-09-29" })).toBe(false);
    expect(periodoValido({ inicio: "2026-09-30", fin: "2026-09-29" })).toBe(false);
  });

  it("acepta inicio igual al fin", () => {
    expect(periodoValido({ inicio: HOY, fin: HOY })).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/modulos/reportes/consultas/periodos.test.ts`
Expected: FAIL ("Cannot find module './periodos'").

- [ ] **Step 3: Implementar**

`src/modulos/reportes/consultas/periodos.ts`:

```ts
import { hoyISO, limitesDelDia } from "./calculos";

/** Funciones puras de fechas para Reportes → Períodos. Todas las
 *  fechas son "YYYY-MM-DD" locales; se usa el mediodía para que un
 *  cambio de horario no corra el día. */

export type AtajoPeriodo = "7d" | "30d" | "mes_actual" | "mes_pasado" | "6m" | "1a" | "personalizado";
export type Granularidad = "dia" | "semana" | "mes";
/** Ambos extremos inclusive. */
export type Periodo = { inicio: string; fin: string };

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function aFecha(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function sumarDias(iso: string, dias: number): string {
  const fecha = aFecha(iso);
  fecha.setDate(fecha.getDate() + dias);
  return hoyISO(fecha);
}

export function diasDelPeriodo(periodo: Periodo): number {
  return Math.round((aFecha(periodo.fin).getTime() - aFecha(periodo.inicio).getTime()) / MS_POR_DIA) + 1;
}

// `mes` es 1-12 y puede salirse de rango (0, -3…): Date lo normaliza al
// año anterior, así "6 meses atrás" cruza de año sin casos especiales.
function primeroDelMes(anio: number, mes: number): string {
  return hoyISO(new Date(anio, mes - 1, 1, 12));
}

// "Últimos 6 meses / último año" = los meses completos anteriores más
// el actual hasta hoy (arrancan el día 1), como pide el dueño para
// comparar meses enteros.
export function periodoDeAtajo(atajo: AtajoPeriodo, hoy: string): Periodo | null {
  const [anio, mes] = hoy.split("-").map(Number);
  switch (atajo) {
    case "7d":
      return { inicio: sumarDias(hoy, -6), fin: hoy };
    case "30d":
      return { inicio: sumarDias(hoy, -29), fin: hoy };
    case "mes_actual":
      return { inicio: primeroDelMes(anio, mes), fin: hoy };
    case "mes_pasado":
      return { inicio: primeroDelMes(anio, mes - 1), fin: sumarDias(primeroDelMes(anio, mes), -1) };
    case "6m":
      return { inicio: primeroDelMes(anio, mes - 5), fin: hoy };
    case "1a":
      return { inicio: primeroDelMes(anio, mes - 11), fin: hoy };
    case "personalizado":
      return null;
  }
}

export function periodoAnterior(periodo: Periodo): Periodo {
  const dias = diasDelPeriodo(periodo);
  const fin = sumarDias(periodo.inicio, -1);
  return { inicio: sumarDias(fin, -(dias - 1)), fin };
}

export function elegirGranularidad(periodo: Periodo): Granularidad {
  const dias = diasDelPeriodo(periodo);
  if (dias <= 31) return "dia";
  if (dias <= 200) return "semana";
  return "mes";
}

export function limitesDelPeriodo(periodo: Periodo): { desde: string; hasta: string } {
  return { desde: limitesDelDia(periodo.inicio).desde, hasta: limitesDelDia(periodo.fin).hasta };
}

// null cuando no hay base de comparación: el período anterior sin
// ventas no tiene un "% de cambio" con sentido (sería infinito).
export function variacionPorcentual(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((actual - anterior) / anterior) * 10000) / 100;
}

export function periodoValido(periodo: Periodo): boolean {
  return periodo.inicio !== "" && periodo.fin !== "" && periodo.inicio <= periodo.fin;
}

export function zonaLocal(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/modulos/reportes/consultas/periodos.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/modulos/reportes/consultas/periodos.ts src/modulos/reportes/consultas/periodos.test.ts
git commit -m "Agregar lógica pura de períodos para reportes"
```

---

### Task 5: Funciones SQL de reportes y su consulta desde el front

**Files:**
- Create: `supabase/migrations/20260929110000_reportes_periodo.sql`
- Create: `src/modulos/reportes/rls.test.ts`
- Modify: `src/modulos/reportes/tipos.ts`
- Modify: `src/modulos/reportes/consultas/reportes.ts`

**Interfaces:**
- Consumes: `Periodo`, `Granularidad`, `limitesDelPeriodo`, `zonaLocal` (Task 4).
- Produces:
  - SQL `reporte_periodo(p_desde timestamptz, p_hasta timestamptz, p_granularidad text, p_zona text) returns jsonb` → `{ total, cantidad, margen, serie: [{ inicio: 'YYYY-MM-DD', total }] }`.
  - SQL `ranking_productos(p_desde timestamptz, p_hasta timestamptz, p_orden text, p_sentido text, p_limite int) returns table(producto_id uuid, nombre text, unidad text, cantidad numeric, monto numeric, no_comprar boolean, no_comprar_motivo text, nuevo boolean)`.
  - TS `obtenerReportePeriodo(supabase, periodo, granularidad): Promise<ReportePeriodo>` y `obtenerRankingProductos(supabase, opciones): Promise<FilaRanking[]>`.
  - Tipos `PuntoSerie`, `ReportePeriodo`, `FilaRanking`, `OrdenRanking`, `SentidoRanking`.

- [ ] **Step 1: Migración**

`supabase/migrations/20260929110000_reportes_periodo.sql`:

```sql
-- Reportes por período: agregados en la base (un año de ventas con sus
-- ítems no entra en el tope de 1000 filas por consulta de Supabase).
-- security invoker: corren con los permisos de quien llama, y además
-- exigen rol dueño a mano porque devuelven márgenes (precio_costo).

create or replace function public.reporte_periodo(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_granularidad text,
  p_zona text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_unidad text;
  v_paso interval;
  v_resultado jsonb;
begin
  if not coalesce(public.auth_activo(), false) or coalesce(public.auth_rol(), '') <> 'dueño' then
    raise exception 'Solo el dueño puede ver los reportes';
  end if;

  if p_hasta <= p_desde then
    raise exception 'El período es inválido';
  end if;

  case p_granularidad
    when 'dia' then v_unidad := 'day'; v_paso := interval '1 day';
    when 'semana' then v_unidad := 'week'; v_paso := interval '1 week';
    when 'mes' then v_unidad := 'month'; v_paso := interval '1 month';
    else raise exception 'Granularidad inválida';
  end case;

  with ventas_p as (
    select v.id, v.total, date_trunc(v_unidad, v.creado_en at time zone p_zona) as tramo
    from public.ventas v
    where v.estado = 'confirmada'
      and v.creado_en >= p_desde
      and v.creado_en < p_hasta
  ),
  serie as (
    -- generate_series sobre timestamp local (sin zona): así todos los
    -- tramos existen aunque no haya ventas y el gráfico no tiene huecos.
    select t.tramo, coalesce(sum(vp.total), 0) as total
    from generate_series(
      date_trunc(v_unidad, p_desde at time zone p_zona),
      (p_hasta - interval '1 second') at time zone p_zona,
      v_paso
    ) as t(tramo)
    left join ventas_p vp on vp.tramo = t.tramo
    group by t.tramo
  ),
  margen as (
    -- Mismo criterio que el dashboard diario: ingreso = subtotal de la
    -- línea, costo = precio_costo ACTUAL × cantidad.
    select coalesce(sum(i.subtotal - p.precio_costo * i.cantidad), 0) as valor
    from public.ventas_items i
    join ventas_p vp on vp.id = i.venta_id
    join public.productos p on p.id = i.producto_id
  )
  select jsonb_build_object(
    'total', coalesce((select sum(total) from ventas_p), 0),
    'cantidad', (select count(*) from ventas_p),
    'margen', (select valor from margen),
    'serie', coalesce(
      (select jsonb_agg(
         jsonb_build_object('inicio', to_char(tramo, 'YYYY-MM-DD'), 'total', total)
         order by tramo
       ) from serie),
      '[]'::jsonb
    )
  )
  into v_resultado;

  return v_resultado;
end;
$$;

create or replace function public.ranking_productos(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_orden text,
  p_sentido text,
  p_limite int
)
returns table (
  producto_id uuid,
  nombre text,
  unidad text,
  cantidad numeric,
  monto numeric,
  no_comprar boolean,
  no_comprar_motivo text,
  nuevo boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not coalesce(public.auth_activo(), false) or coalesce(public.auth_rol(), '') <> 'dueño' then
    raise exception 'Solo el dueño puede ver los reportes';
  end if;

  if p_orden not in ('cantidad', 'monto') or p_sentido not in ('asc', 'desc') then
    raise exception 'Orden inválido';
  end if;

  return query
  with vendido as (
    select i.producto_id, sum(i.cantidad) as cantidad, sum(i.subtotal) as monto
    from public.ventas_items i
    join public.ventas v on v.id = i.venta_id
    where v.estado = 'confirmada'
      and v.creado_en >= p_desde
      and v.creado_en < p_hasta
    group by i.producto_id
  ),
  ranking as (
    -- Solo productos activos (uno eliminado ya no se puede comprar ni
    -- vender); los que no vendieron nada entran con 0.
    select
      p.id as producto_id,
      p.nombre,
      p.unidad,
      coalesce(vd.cantidad, 0) as cantidad,
      coalesce(vd.monto, 0) as monto,
      p.no_comprar,
      p.no_comprar_motivo,
      -- "Nuevo" en el período: cargado después del inicio, así un
      -- producto de la semana pasada no parece "el que menos se vende".
      (p.creado_en >= p_desde) as nuevo
    from public.productos p
    left join vendido vd on vd.producto_id = p.id
    where p.activo
  )
  select r.producto_id, r.nombre, r.unidad, r.cantidad, r.monto, r.no_comprar, r.no_comprar_motivo, r.nuevo
  from ranking r
  order by
    (case when p_sentido = 'desc' then (case p_orden when 'cantidad' then r.cantidad else r.monto end) end) desc nulls last,
    (case when p_sentido = 'asc' then (case p_orden when 'cantidad' then r.cantidad else r.monto end) end) asc nulls last,
    r.nombre
  limit greatest(p_limite, 1);
end;
$$;
```

- [ ] **Step 2: Test RLS que falla (antes de aplicar la migración)**

`src/modulos/reportes/rls.test.ts`:

```ts
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
      p_zona: "America/Argentina/Buenos_Aires",
    });
    expect(error).not.toBeNull();
  });

  it("el operador no puede llamarla directo", async () => {
    const { error } = await clienteOperador.rpc("reporte_periodo", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_granularidad: "dia",
      p_zona: "America/Argentina/Buenos_Aires",
    });
    expect(error?.message).toMatch(/dueño/);
  });

  it("período sin ventas: todo en cero y un tramo por día, sin huecos", async () => {
    const { data, error } = await clienteDueño.rpc("reporte_periodo", {
      p_desde: DESDE,
      p_hasta: HASTA,
      p_granularidad: "dia",
      p_zona: "America/Argentina/Buenos_Aires",
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
      p_zona: "America/Argentina/Buenos_Aires",
    });
    expect(errorGranularidad?.message).toMatch(/Granularidad/);

    const { error: errorRango } = await clienteDueño.rpc("reporte_periodo", {
      p_desde: HASTA,
      p_hasta: DESDE,
      p_granularidad: "dia",
      p_zona: "America/Argentina/Buenos_Aires",
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
```

Run: `npx vitest run src/modulos/reportes/rls.test.ts`
Expected: FAIL (`function public.reporte_periodo … does not exist`).

- [ ] **Step 3: Aplicar la migración (pedir OK a Enzo primero) y correr**

Local: `npx supabase db reset`. Hosteado: `npx supabase db push`.
Run: `npx vitest run src/modulos/reportes/rls.test.ts`
Expected: PASS (7 tests). Si la serie de días no coincide con el rango (por la zona), revisar que `p_zona` llegue como zona IANA válida.

- [ ] **Step 4: Tipos**

Agregar al final de `src/modulos/reportes/tipos.ts`:

```ts
export type PuntoSerie = { inicio: string; total: number };

export type ReportePeriodo = {
  total: number;
  cantidad: number;
  ticketPromedio: number;
  margen: number;
  serie: PuntoSerie[];
};

export type OrdenRanking = "monto" | "cantidad";
export type SentidoRanking = "desc" | "asc";

export type FilaRanking = {
  productoId: string;
  nombre: string;
  unidad: "unidad" | "kg" | "litro";
  cantidad: number;
  monto: number;
  noComprar: boolean;
  noComprarMotivo: string | null;
  nuevo: boolean;
};
```

- [ ] **Step 5: Consultas del front**

En `src/modulos/reportes/consultas/reportes.ts`: cambiar los imports a

```ts
import type { FilaRanking, OrdenRanking, ReportePeriodo, SentidoRanking, VentaReporte } from "../tipos";
import { limitesDelDia } from "./calculos";
import { limitesDelPeriodo, zonaLocal, type Granularidad, type Periodo } from "./periodos";
```

y agregar al final del archivo:

```ts
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
```

- [ ] **Step 6: Verificar y commit**

Run: `npm run typecheck && npm run lint`
Expected: sin errores.

```bash
git add supabase/migrations/20260929110000_reportes_periodo.sql src/modulos/reportes
git commit -m "Agregar funciones SQL y consultas de reportes por período"
```

---

### Task 6: Pestañas y pestaña "Períodos" → Ventas

**Files:**
- Create: `src/modulos/reportes/componentes/PestanasReportes.tsx`
- Create: `src/modulos/reportes/componentes/SelectorPeriodo.tsx`
- Create: `src/modulos/reportes/componentes/GraficoEvolucion.tsx`
- Create: `src/modulos/reportes/componentes/PanelPeriodos.tsx`
- Modify: `src/app/(app)/reportes/page.tsx`

**Interfaces:**
- Consumes: todo lo de Task 4 y `obtenerReportePeriodo` (Task 5), `hoyISO`.
- Produces: `<PestanasReportes diario={ReactNode} />`; `<PanelPeriodos />` (sin props; el ranking se conecta en Task 7 dentro de este mismo panel).

- [ ] **Step 1: Pestañas**

`src/modulos/reportes/componentes/PestanasReportes.tsx`:

```tsx
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
```

- [ ] **Step 2: Selector de período**

`src/modulos/reportes/componentes/SelectorPeriodo.tsx`:

```tsx
"use client";

import { Campo } from "@/componentes/Campo";
import { hoyISO } from "../consultas/calculos";
import type { AtajoPeriodo, Periodo } from "../consultas/periodos";

const atajos: { id: AtajoPeriodo; titulo: string }[] = [
  { id: "7d", titulo: "Últimos 7 días" },
  { id: "30d", titulo: "Últimos 30 días" },
  { id: "mes_actual", titulo: "Este mes" },
  { id: "mes_pasado", titulo: "Mes pasado" },
  { id: "6m", titulo: "Últimos 6 meses" },
  { id: "1a", titulo: "Último año" },
  { id: "personalizado", titulo: "Personalizado" },
];

const clasesSelect =
  "rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-2 text-sm text-texto outline-none focus-visible:border-acento focus-visible:ring-2 focus-visible:ring-acento/40";

export function SelectorPeriodo({
  atajo,
  periodo,
  comparar,
  alElegirAtajo,
  alCambiarPeriodo,
  alCambiarComparar,
}: {
  atajo: AtajoPeriodo;
  periodo: Periodo;
  comparar: boolean;
  alElegirAtajo: (atajo: AtajoPeriodo) => void;
  alCambiarPeriodo: (periodo: Periodo) => void;
  alCambiarComparar: (comparar: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-texto-suave">Período</span>
        <select
          className={clasesSelect}
          value={atajo}
          onChange={(evento) => alElegirAtajo(evento.target.value as AtajoPeriodo)}
        >
          {atajos.map((opcion) => (
            <option key={opcion.id} value={opcion.id}>
              {opcion.titulo}
            </option>
          ))}
        </select>
      </label>

      {atajo === "personalizado" && (
        <>
          <Campo
            etiqueta="Desde"
            id="periodoDesde"
            type="date"
            value={periodo.inicio}
            max={hoyISO()}
            onChange={(evento) => alCambiarPeriodo({ ...periodo, inicio: evento.target.value })}
          />
          <Campo
            etiqueta="Hasta"
            id="periodoHasta"
            type="date"
            value={periodo.fin}
            max={hoyISO()}
            onChange={(evento) => alCambiarPeriodo({ ...periodo, fin: evento.target.value })}
          />
        </>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-texto-suave">Comparación</span>
        <select
          className={clasesSelect}
          value={comparar ? "anterior" : "ninguna"}
          onChange={(evento) => alCambiarComparar(evento.target.value === "anterior")}
        >
          <option value="ninguna">Sin comparar</option>
          <option value="anterior">Período anterior</option>
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Gráfico de evolución (SVG, sin librerías)**

`src/modulos/reportes/componentes/GraficoEvolucion.tsx`:

```tsx
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
```

- [ ] **Step 4: Panel de Períodos (solo Ventas por ahora)**

`src/modulos/reportes/componentes/PanelPeriodos.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { hoyISO } from "../consultas/calculos";
import {
  elegirGranularidad,
  periodoAnterior,
  periodoDeAtajo,
  periodoValido,
  variacionPorcentual,
  type AtajoPeriodo,
  type Periodo,
} from "../consultas/periodos";
import { obtenerReportePeriodo } from "../consultas/reportes";
import type { ReportePeriodo } from "../tipos";
import { GraficoEvolucion } from "./GraficoEvolucion";
import { SelectorPeriodo } from "./SelectorPeriodo";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export function PanelPeriodos() {
  const [atajo, setAtajo] = useState<AtajoPeriodo>("30d");
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDeAtajo("30d", hoyISO())!);
  const [comparar, setComparar] = useState(false);
  const [actual, setActual] = useState<ReportePeriodo | null>(null);
  const [previo, setPrevio] = useState<ReportePeriodo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valido = periodoValido(periodo);
  const granularidad = useMemo(() => (valido ? elegirGranularidad(periodo) : "dia"), [periodo, valido]);

  useEffect(() => {
    if (!valido) return;
    let vigente = true;
    setCargando(true);
    setError(null);
    const supabase = crearClienteNavegador();
    Promise.all([
      obtenerReportePeriodo(supabase, periodo, granularidad),
      comparar ? obtenerReportePeriodo(supabase, periodoAnterior(periodo), granularidad) : Promise.resolve(null),
    ])
      .then(([reporteActual, reportePrevio]) => {
        if (!vigente) return;
        setActual(reporteActual);
        setPrevio(reportePrevio);
      })
      .catch(() => {
        if (vigente) setError("No se pudo cargar el reporte. Probá de nuevo.");
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [periodo, granularidad, comparar, valido]);

  function elegirAtajo(nuevo: AtajoPeriodo) {
    setAtajo(nuevo);
    const definido = periodoDeAtajo(nuevo, hoyISO());
    if (definido) setPeriodo(definido);
  }

  const variacion = actual && previo ? variacionPorcentual(actual.total, previo.total) : null;

  return (
    <div className="flex flex-col gap-4">
      <SelectorPeriodo
        atajo={atajo}
        periodo={periodo}
        comparar={comparar}
        alElegirAtajo={elegirAtajo}
        alCambiarPeriodo={setPeriodo}
        alCambiarComparar={setComparar}
      />

      {!valido && (
        <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">
          Elegí una fecha de inicio y una de fin, y que el inicio no sea posterior al fin.
        </p>
      )}
      {error && (
        <p className="rounded-[var(--radius-base)] bg-alerta-fondo px-3 py-2 text-sm text-alerta">{error}</p>
      )}

      {valido && actual && (
        <div className={`flex flex-col gap-4 transition-opacity ${cargando ? "opacity-50" : ""}`}>
          <div className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">Volumen de ventas</p>
            <p className="numero mt-1 text-3xl font-semibold text-texto">{platita.format(actual.total)}</p>
            {comparar && previo && (
              <p className="mt-1 text-sm text-texto-suave">
                {variacion === null ? (
                  "—"
                ) : (
                  <span className={variacion >= 0 ? "text-ok" : "text-alerta"}>
                    {variacion >= 0 ? "↑" : "↓"} {Math.abs(variacion).toLocaleString("es-AR")}%
                  </span>
                )}{" "}
                vs período anterior {platita.format(previo.total)}
              </p>
            )}
          </div>

          <GraficoEvolucion serie={actual.serie} anterior={previo?.serie} />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { etiqueta: "Cantidad de ventas", valor: String(actual.cantidad) },
              { etiqueta: "Ticket promedio", valor: platita.format(actual.ticketPromedio) },
              { etiqueta: "Balance", valor: platita.format(actual.margen), negativo: actual.margen < 0 },
            ].map((tarjeta) => (
              <div key={tarjeta.etiqueta} className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-texto-suave">{tarjeta.etiqueta}</p>
                <p className={`numero mt-1 text-2xl font-semibold ${tarjeta.negativo ? "text-alerta" : "text-texto"}`}>
                  {tarjeta.valor}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Enchufar en la página**

`src/app/(app)/reportes/page.tsx`: agregar el import
`import { PestanasReportes } from "@/modulos/reportes/componentes/PestanasReportes";`
y reemplazar el `<PanelReportes … />` por:

```tsx
        <PestanasReportes
          diario={
            <PanelReportes
              fechaInicial={fecha}
              resumenInicial={calcularResumenDelDia(ventas)}
              ventasIniciales={ventas}
              productos={productos}
              categorias={categorias}
              proveedores={proveedores}
              clientes={clientes}
            />
          }
        />
```

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run lint`
Luego `npm run dev`, entrar como dueño a `/reportes`:
1. Pestaña Diario funciona igual que antes.
2. En Períodos elegir "Este mes": el total mostrado coincide con la suma de los días de este mes en Diario (probar con un rango de un solo día: Personalizado, Desde = Hasta = hoy → debe dar el mismo Ventas y Balance que Diario de hoy).
3. Sin ventas en el rango: total $0, ticket $0, gráfico sin romperse.
4. Activar "Período anterior": aparece la variación y la línea punteada; con período anterior en cero se ve "—".
5. Personalizado con Desde > Hasta: aparece el mensaje y no se dispara ninguna consulta.
Expected: todo coincide. Lo que no se pueda comprobar, decirlo.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "Agregar la pestaña Períodos a Reportes con ventas y comparación"
```

---

### Task 7: Subpestaña Productos (ranking) con botón "No comprar más"

**Files:**
- Create: `src/modulos/reportes/componentes/TablaRankingProductos.tsx`
- Modify: `src/modulos/reportes/componentes/PanelPeriodos.tsx`

**Interfaces:**
- Consumes: `obtenerRankingProductos`, `FilaRanking`, `OrdenRanking`, `SentidoRanking` (Task 5); `<BotonNoComprar>` y `<EtiquetaNoComprar>` (Tasks 2–3); `Periodo` (Task 4).
- Produces: `<TablaRankingProductos periodo={Periodo} />`.

- [ ] **Step 1: Tabla de ranking**

`src/modulos/reportes/componentes/TablaRankingProductos.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Insignia } from "@/componentes/Insignia";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { BotonNoComprar } from "@/modulos/stock/componentes/BotonNoComprar";
import { EtiquetaNoComprar } from "@/modulos/stock/componentes/EtiquetaNoComprar";
import type { Periodo } from "../consultas/periodos";
import { obtenerRankingProductos } from "../consultas/reportes";
import type { FilaRanking, OrdenRanking, SentidoRanking } from "../tipos";

const platita = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });
const LIMITES = [10, 25, 50];

const clasesSelect =
  "rounded-[var(--radius-base)] border border-linea bg-superficie px-3 py-1.5 text-sm text-texto outline-none focus-visible:border-acento";

function Ranking({
  titulo,
  periodo,
  sentido,
  orden,
  limite,
}: {
  titulo: string;
  periodo: Periodo;
  sentido: SentidoRanking;
  orden: OrdenRanking;
  limite: number;
}) {
  const [filas, setFilas] = useState<FilaRanking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    let vigente = true;
    setError(null);
    obtenerRankingProductos(crearClienteNavegador(), { periodo, orden, sentido, limite })
      .then((resultado) => {
        if (vigente) setFilas(resultado);
      })
      .catch(() => {
        if (vigente) setError("No se pudo cargar el ranking. Probá de nuevo.");
      });
    return () => {
      vigente = false;
    };
  }, [periodo, orden, sentido, limite]);

  useEffect(() => cargar(), [cargar]);

  return (
    <div className="rounded-[var(--radius-base)] border border-linea bg-superficie p-4">
      <p className="mb-3 text-sm font-semibold text-texto">{titulo}</p>
      {error ? (
        <p className="text-sm text-alerta">{error}</p>
      ) : filas === null ? (
        <p className="py-6 text-center text-sm text-texto-suave">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="py-6 text-center text-sm text-texto-suave">No hay productos para mostrar.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-linea">
          {filas.map((fila, indice) => (
            <li key={fila.productoId} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-texto">
                  <span className="numero mr-2 text-xs text-texto-suave">{indice + 1}.</span>
                  {fila.nombre}
                  {fila.nuevo && (
                    <span className="ml-2">
                      <Insignia variante="ok">nuevo</Insignia>
                    </span>
                  )}
                </span>
                {fila.noComprar && <EtiquetaNoComprar motivo={fila.noComprarMotivo} />}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="numero text-texto">
                  {orden === "monto"
                    ? platita.format(fila.monto)
                    : `${numero.format(fila.cantidad)} ${fila.unidad === "unidad" ? "u" : fila.unidad}`}
                </span>
                <span className="numero text-xs text-texto-suave">
                  {orden === "monto"
                    ? `${numero.format(fila.cantidad)} ${fila.unidad === "unidad" ? "u" : fila.unidad}`
                    : platita.format(fila.monto)}
                </span>
                <BotonNoComprar producto={{ ...fila, id: fila.productoId }} onCambio={cargar} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TablaRankingProductos({ periodo }: { periodo: Periodo }) {
  // Por defecto por monto: hay productos por kg/litro y no se pueden
  // comparar en unidades contra los de unidad.
  const [orden, setOrden] = useState<OrdenRanking>("monto");
  const [limite, setLimite] = useState(10);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-texto-suave">Ordenar por</span>
          <select className={clasesSelect} value={orden} onChange={(e) => setOrden(e.target.value as OrdenRanking)}>
            <option value="monto">Monto vendido</option>
            <option value="cantidad">Unidades vendidas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-texto-suave">Mostrar</span>
          <select className={clasesSelect} value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
            {LIMITES.map((valor) => (
              <option key={valor} value={valor}>
                Top {valor}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Ranking titulo="Más vendidos" periodo={periodo} sentido="desc" orden={orden} limite={limite} />
        <Ranking titulo="Menos vendidos" periodo={periodo} sentido="asc" orden={orden} limite={limite} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Subpestañas Ventas / Productos en `PanelPeriodos`**

En `src/modulos/reportes/componentes/PanelPeriodos.tsx`:

1. Import: `import { TablaRankingProductos } from "./TablaRankingProductos";`
2. Estado nuevo junto a los demás: `const [vista, setVista] = useState<"ventas" | "productos">("ventas");`
3. Justo debajo de los dos mensajes de error (`{!valido && …}` y `{error && …}`), antes del bloque `{valido && actual && (`, agregar:

```tsx
      <div role="tablist" className="flex gap-1">
        {(["ventas", "productos"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={vista === id}
            onClick={() => setVista(id)}
            className={`rounded-[var(--radius-base)] px-3 py-1.5 text-sm font-medium transition ${
              vista === id ? "bg-acento text-acento-texto" : "text-texto-suave hover:text-texto"
            }`}
          >
            {id === "ventas" ? "Ventas" : "Productos"}
          </button>
        ))}
      </div>

      {valido && vista === "productos" && <TablaRankingProductos periodo={periodo} />}
```

4. Cambiar la condición del bloque de ventas de `{valido && actual && (` a `{valido && vista === "ventas" && actual && (`.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Luego `npm run dev` como dueño, Reportes → Períodos → Productos:
1. "Más vendidos" y "Menos vendidos" se llenan; con "Último año" los menos vendidos incluyen productos con 0.
2. El interruptor Monto/Unidades reordena; Top 10/25/50 cambia la cantidad de filas.
3. "No comprar más" en una fila → modal con motivo → Marcar: la fila muestra la etiqueta roja y el botón pasa a "Quitar…"; el producto aparece en Proveedores → "No comprar más".
4. Un producto cargado dentro del período muestra "nuevo".
Expected: todo coincide. Lo que no se pueda comprobar, decirlo.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "Agregar ranking de productos más y menos vendidos con acceso a no comprar más"
```

---

### Task 8: Documentación y verificación final

**Files:**
- Modify: `README.md` (secciones "Reportes" y "Proveedores")

- [ ] **Step 1: README**

En la sección `### Reportes (\`/reportes\`, solo dueño)`, reemplazar la primera viñeta ("Dashboard de un día elegido…") por:

```markdown
- Dos pestañas. **Diario:** dashboard de un día elegido (Ventas, Ticket
  promedio, Transacciones, Balance, ventas por hora, medios de pago,
  top 10 productos, alertas de stock y detalle de ventas con desglose
  por medio y ticket; export a Excel). **Períodos:** ventas y ranking
  por rango de fechas.
- **Períodos:** atajos (7/30 días, este mes, mes pasado, 6 meses, último
  año) o fechas a mano, con comparación contra el período anterior
  (mismo largo, justo antes). Subpestaña *Ventas*: volumen, variación %,
  gráfico de evolución (por día hasta 31 días, por semana hasta ~6
  meses, por mes más allá), cantidad de ventas, ticket promedio y
  Balance. Subpestaña *Productos*: más y menos vendidos por monto o por
  unidades (top 10/25/50); los menos vendidos incluyen los que no
  vendieron nada, y los cargados dentro del período llevan "nuevo". Los
  agregados se calculan en Postgres (`reporte_periodo`,
  `ranking_productos`; solo dueño) y cuentan solo ventas confirmadas.
```

En la sección `### Proveedores (\`/proveedores\`)`, agregar al final:

```markdown
**No comprar más:** el dueño marca un producto (desde Stock → Editar o
desde el ranking de Reportes → Períodos → Productos) con un motivo
opcional. Aparece en el listado "No comprar más" de Proveedores, con
etiqueta roja y aviso al armar un pedido y en las alertas de stock. Es
solo un aviso, no bloquea. Vive en `productos.no_comprar` /
`no_comprar_motivo` / `no_comprar_desde`; un producto eliminado no
figura en la lista.
```

- [ ] **Step 2: Verificación completa**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`
Expected: todo pasa. Con la base al día: `npx vitest run src/modulos/stock/rls.test.ts src/modulos/reportes/rls.test.ts` en verde.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Documentar reportes por período y la lista no comprar más en el README"
```
