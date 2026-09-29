# Mini Market Marlyn — sistema de gestión

Sistema de gestión a medida para Mini Market Marlyn, un minimarket de un
solo local: punto de venta, stock, caja, clientes con cuenta corriente
(fiado), proveedores, promociones, reportes y una pantalla para el
cliente en el mostrador.

**Stack:** Next.js 16 (App Router) + React 19, Supabase (Postgres, Auth,
Realtime) con RLS en todas las tablas, Tailwind CSS 4 y Vitest. Excel con
`exceljs`; ticket en PNG/PDF con `html-to-image` + `jspdf`.

## Cómo levantarlo

1. `npm install`
2. Copiar `.env.local.example` a `.env.local` y completar la URL, la
   `anon key` y la `service_role key` del proyecto Supabase
   ("Project Settings → API").
3. Aplicar las migraciones de `supabase/migrations/`:
   - **Supabase hosteado:** `npx supabase login`,
     `npx supabase link --project-ref <ref>` y `npx supabase db push`.
     Sin login, `npx supabase db push --db-url "<connection string>"`
     (si la conexión directa falla por IPv6, usar la del *session
     pooler*, puerto 5432).
   - **Local con Docker:** `npx supabase start` levanta todo y aplica
     las migraciones; `npx supabase db reset` las reaplica desde cero.
4. `npm run dev` → http://localhost:3000

| Script | Qué hace |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` + `tsc` (typegen genera en `.next/` los tipos de rutas que usa el layout) |
| `npm run test` | Todos los tests |
| `npm run test:unit` | Todo menos `*rls.test.ts` |
| `npm run build` | Build de producción |

**Tests:** los `*rls.test.ts` se conectan al Supabase de `.env.local` y
crean datos reales; se corren a mano después de aplicar una migración.
El resto son puros. CI (`.github/workflows/ci.yml`) corre lint,
typecheck y `test:unit` en cada push a `master` y en cada PR. Un test
que pega contra la base tiene que llevar ese sufijo, o CI lo corre sin
claves y falla.

## Estructura

```
src/
  app/
    (app)/<módulo>/     pantallas con sesión
    ingresar/           login
    pantalla/[token]/   TV del mostrador, sin sesión
  modulos/<módulo>/
    componentes/        UI del módulo
    consultas/          acceso a datos y lógica pura (con tests)
  componentes/          UI compartida (Modal, Campo, CampoPrecio, TicketVenta…)
  lib/                  utilidades puras y clientes de Supabase
  config/cliente.ts     módulos prendidos, complementos y reglas de negocio
  estilos/tema.css      tokens de diseño: único archivo con colores literales
  proxy.ts              refresca la sesión de Supabase en cada request
supabase/
  migrations/           esquema, RLS, funciones y vistas
  operaciones/          scripts de datos de una sola vez
entregables/            instructivo de uso, informe técnico y manual del cliente
PROMOCIONES.md          diseño del módulo de promociones
PENDIENTES.md           ideas acordadas que todavía no se construyeron
```

## Módulos

### Ventas (`/ventas`)

- **Un solo campo para escanear o buscar.** Un código exacto + Enter
  agrega el producto; un texto filtra la grilla. Todos los buscadores
  de la app encuentran por palabras en cualquier orden
  (`lib/busqueda.ts`).
- **Varias ventas en curso**, en pestañas, guardadas en
  `sessionStorage` (sobreviven a un F5).
- **Productos por kg/litro:** se cargan por gramos o por monto en pesos.
  El monto tipeado es la fuente de verdad del subtotal de la línea; no
  se recalcula como `cantidad × precio`.
- **Medios de pago:** efectivo, transferencia, débito, crédito, mixto
  (dos pagos) y fiado, total o parcial (se cobra una parte y el resto va
  a cuenta corriente). Débito y crédito aceptan un % de recargo a mano:
  `ventas.subtotal` es lo que valen los productos y `ventas.total` lo
  que se cobró.
- Las **promociones** se aplican solas al armar el carrito.
- Para fiar se puede dar de alta un cliente en el momento.
- **"Ventas de este turno"** (también en Caja) lista las ventas con el
  desglose por medio; desde ahí se anula una venta, con motivo.

### Ticket

`TicketVenta.tsx` + `AccionesTicket.tsx`. Se abre al cobrar y desde
Reportes → Detalle de ventas (reconstruido con los datos de la venta; no
se guarda aparte). Permite imprimir, descargar en PNG o PDF y, con el
engranaje, elegir el rollo de la impresora (58 u 80 mm, guardado en el
navegador de esa PC; 80 mm por defecto). Es un comprobante no fiscal.
Cómo funciona la impresión: ver [Impresión](#impresión).

### Caja (`/caja`)

- **Un solo turno abierto para todo el local** (hay un solo cajón): lo
  ve y lo opera cualquier usuario activo.
- **"Debería haber"** = apertura + efectivo de ventas (neto de vuelto) +
  pagos de cuenta corriente en efectivo ± retiros/ingresos manuales
  (con motivo).
- **Cierre con arqueo:** contado contra calculado, con sobrante o
  faltante; los montos quedan congelados en el turno.
- Historial de los últimos 30 cierres y export a Excel del turno.

### Stock (`/stock`)

- Listado paginado con buscador, filtros por rubro/estado y alerta de
  stock mínimo. Export a Excel.
- **Alta y edición** con calculadora de precio: costo → % de ganancia
  (+ IVA opcional) → precio de venta, y al revés.
- **Códigos de barra:** uno principal (`productos.codigo_barras`) y hasta
  19 adicionales (`productos_codigos_barras`) para variantes que van al
  mismo precio; comparten stock y nombre. Triggers garantizan que un
  código no se repita entre las dos tablas.
- **Ajustar stock** (entrada/salida) y **Carga rápida** para reponer
  varios productos seguidos. No se permite stock negativo.
- **Eliminar:** si el producto no tiene historia se borra; si tiene
  ventas o movimientos se marca `activo = false` y sigue apareciendo en
  el historial como "[Eliminado]". Borrar un rubro o proveedor deja a
  sus productos sin ese dato.
- **Rubros**, **etiquetas de góndola** (21 por hoja A4, nombre y precio)
  e **importar catálogo** desde Excel.

**Importar catálogo** (`stock/consultas/importarExcel.ts`, lógica pura
con tests; se aplica en una sola transacción con `importar_catalogo()`).
Reconoce dos formatos por sus encabezados:

1. El del sistema anterior: `Descripcion, Proveedor, Codigo de barra,
   Familia, Costo`. El precio de venta se calcula con el % de margen que
   se elige al importar.
2. La plantilla que exporta la app: `Código de barras, Producto, Rubro,
   Proveedor, Precio costo, Precio venta, Stock actual, Stock mínimo,
   Unidad`.

Reglas: los códigos de relleno (`0`, dígitos repetidos) entran como "sin
código"; si el código ya existe en la base, la fila se saltea; rubros y
proveedores se normalizan y se crean si faltan; **el stock nunca se
importa** (arranca en 0 y se carga con Ajustar stock); una fila con un
dato inválido se rechaza con su número y nombre, y el resto entra igual.

### Clientes (`/clientes`)

- Ficha y cuenta corriente: fiados con el detalle de productos, pagos y
  recargos. Export a Excel.
- **Registrar pago** con medio; si es en efectivo entra a la caja
  (requiere caja abierta).
- **Recargo por atraso:** un % a criterio del dueño.
- **Actualizar precios del fiado:** compara el precio al que se llevó
  cada producto con el de hoy, para los fiados del ciclo abierto (desde
  la última vez que la cuenta quedó en cero o a favor). Solo suma lo que
  subió, nunca cobra dos veces el mismo aumento, y el monto lo calcula
  la base. Se puede exportar la comparación.
- Un saldo negativo se muestra como "A favor".

### Proveedores (`/proveedores`)

Ficha (nombre, contacto, teléfono), productos de cada proveedor y armado
del pedido en texto para copiar o mandar por WhatsApp (`wa.me`; al número
se le antepone 54, y un celular puede necesitar además el 9, así que
conviene cargarlo completo). Desde el alta de producto también se puede
crear un proveedor con solo el nombre.

**No comprar más:** el dueño marca un producto (desde Stock → Editar o
desde el ranking de Reportes → Períodos → Productos) con un motivo
opcional. Aparece en el listado "No comprar más" de Proveedores, con
etiqueta roja y aviso al armar un pedido y en las alertas de stock. Es
solo un aviso, no bloquea. Vive en `productos.no_comprar` /
`no_comprar_motivo` / `no_comprar_desde`; un producto eliminado no
figura en la lista.

### Promociones (`/promociones`)

Descuento por cantidad ("3 × $100") y combos de productos distintos a
precio fijo. El dueño las crea y edita; el colaborador solo las ve.
Modelo de datos y algoritmo en [`PROMOCIONES.md`](PROMOCIONES.md).

### Reportes (`/reportes`, solo dueño)

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
- **Balance** es margen bruto calculado con el costo *actual* de cada
  producto: no se guarda el costo histórico por venta.
- **Backup completo:** un `.xlsx` con una hoja por tabla y las
  referencias resueltas a nombres.
- **Reimportar backup:** vuelve a subir categorías, proveedores,
  productos y clientes editados a mano (upsert por `id`; nunca borra ni
  toca stock o saldos). Ventas, pagos y movimientos no se reimportan.
  Para recuperarse de un desastre están los backups nativos de Postgres
  (PITR de Supabase o `pg_dump`).

### Notas (`/notas`)

Notas de texto libre con fecha, para pedidos, recordatorios o lo que
haga falta.

### Pantalla al cliente (`/pantalla-cliente` → `/pantalla/[token]`)

`/pantalla-cliente` muestra un link único del comercio (token en
`configuracion_comercio`) que se abre en la TV sin iniciar sesión. El
carrito de la pestaña activa viaja por Supabase Realtime Broadcast
(canal `pantalla:<token>`), no por una tabla. Sin venta en curso, un
protector de pantalla mueve el contenido para evitar quemar la TV. Se
apaga en `config/cliente.ts`, e ignora `prefers-reduced-motion` a
propósito porque muchos televisores lo traen activado.

### Usuarios y Auditoría (solo dueño)

- **`/usuarios`:** alta de colaboradores con usuario y clave (Supabase
  Auth exige email, así que se arma `usuario@marlyn.local`; el login
  acepta usuario o correo), activar/desactivar y restablecer contraseña.
  Son Server Actions con la clave de servicio (`lib/supabase/admin.ts`,
  protegido con `server-only`).
- **`/auditoria`:** una sola lista con movimientos de stock, cuenta
  corriente y caja, ventas anuladas y cierres con faltante. Filtros por
  fecha, usuario y tipo, y export a Excel.

## Roles

| | Dueño | Colaborador (`operador` en la base) |
| --- | --- | --- |
| Vender, cobrar, anular ventas del turno | ✓ | ✓ |
| Ajustar stock y carga rápida | ✓ | ✓ (sin tocar precios) |
| Clientes: alta, pagos | ✓ | ✓ |
| Recargos por atraso y actualización de precios del fiado | ✓ | — |
| Crear/editar/eliminar productos, rubros, proveedores y promociones | ✓ | — (solo lectura) |
| Ver precio de costo | ✓ | — |
| Reportes, Usuarios, Auditoría | ✓ | — |
| Historial de cierres de caja | todos | solo los propios |

La barrera real es la RLS de cada tabla; la interfaz solo esconde lo que
fallaría. El costo se oculta en la base: la vista `productos_visibles`
lo devuelve `null` para el colaborador.

## Base de datos

- **Migraciones** en `supabase/migrations/`, en orden. No se edita una
  ya aplicada: se agrega una nueva.
- **RLS en todas las tablas**, con `auth_rol()` y `auth_activo()`. Un
  perfil desactivado no ve nada.
- **El estado derivado** (`productos.stock_actual`,
  `clientes.saldo_cuenta_corriente`, caja) solo lo mueven funciones
  `security definer`, cada una con su fila de movimiento:
  - `registrar_venta` / `anular_venta`. Anular devuelve stock, fiado y
    caja, y se bloquea si hubo movimientos en la cuenta corriente
    después de ese fiado (el ajuste se hace a mano desde Clientes).
  - `registrar_ajuste_stock`
  - `registrar_movimiento_cuenta_corriente`
  - `calcular_actualizacion_precios_fiado` /
    `registrar_actualizacion_precios_fiado`
  - `importar_catalogo` / `reimportar_maestros`
  - `guardar_codigos_barras_adicionales`
  - `guardar_promocion` / `activar_promocion`
  - `resolver_pantalla`, la única que puede llamar un visitante sin
    sesión (la TV).
- **Vistas:** `productos_visibles` (costo según rol y códigos
  adicionales) y `auditoria_movimientos` (solo dueño).
- `configuracion_comercio` es una tabla de una sola fila con los datos
  del comercio (hoy, el token de la pantalla).

## Impresión

- Lo imprimible (ticket y etiquetas) se renderiza con `CapaImpresion`
  directo en `<body>`, y `@media print` oculta el resto de la app.
- **Ticket:** la página se arma al imprimir con el ancho del rollo y el
  alto medido del ticket (`reglaPaginaTicket()` en
  `lib/rolloTicket.ts`). Va en negro sobre blanco, porque la térmica no
  imprime grises.
- **Etiquetas:** página A4 con 3 mm de margen (`@page etiquetas-a4`);
  el tamaño de cada etiqueta está calculado contra ese margen.
- En pantalla, la copia imprimible está oculta. Para capturarla (PNG/PDF)
  o medirla se dibuja un momento fuera de la pantalla
  (`.capa-impresion.fuera-de-pantalla`).
- Se usa la impresión del navegador: la térmica tiene que estar
  instalada como impresora de Windows. No hay integración ESC/POS
  directa ni apertura del cajón.

## Al tocar el código

- **PostgREST corta toda consulta en 1000 filas** sin avisar. Para
  tablas grandes, usar `traerTodasLasFilas()`
  (`lib/supabase/paginado.ts`).
- **`create or replace function` con otra lista de parámetros** crea una
  sobrecarga en vez de reemplazar la función: hacer `drop function`
  antes.
- **En funciones con `returns table(...)`**, las columnas de salida son
  variables dentro del cuerpo: calificar cada columna con su tabla.
- **Colores:** solo tokens de `tema.css`.
- **Formularios:** `noValidate` y validación propia (la nativa bloquea el
  submit). En alta y edición de producto, el Enter del lector de códigos
  no envía el formulario.
- **Campos numéricos:** sin flechitas y con blur al usar la rueda del
  mouse (`Campo.tsx`), para que el scroll no cambie valores.
- **Horas:** usar `formatearHora()` (`lib/formato.ts`). Node y el
  navegador separan "a. m." con espacios distintos y eso rompe la
  hidratación.
- **Librerías pesadas** (`exceljs`, `html-to-image`, `jspdf`) se importan
  recién al hacer click. `exceljs` además va en `serverExternalPackages`
  (`next.config.ts`).
- **Exports a Excel:** `filaSegura()` (`lib/excel.ts`) protege contra CSV
  / Formula Injection. Hoy la usan el backup y Auditoría; los exports de
  Stock, Caja, cuenta corriente, comparación de precios y Reportes
  todavía no.

## Configuración (`src/config/cliente.ts`)

Qué módulos están prendidos (apagar uno oculta su navegación sin borrar
código), complementos (pantalla al cliente, protector de pantalla) y
reglas de negocio: sin stock negativo, fiado sin límite duro, IVA 21% en
la calculadora de precios.

## Fuera de alcance

- Facturación fiscal (el ticket no es fiscal).
- Impresión ESC/POS directa y apertura del cajón de dinero.
- Compras formales (órdenes de compra y recepción), vencimientos y metas
  de venta.
- Funcionamiento sin conexión.
- Pasarelas de pago: transferencia y tarjeta se registran como cobradas,
  sin conciliación.

## Preguntas abiertas con el cliente

- ¿El monto de apertura de caja es siempre el mismo?
- ¿Se redondean precios o totales?
- ¿Hay cajonera electrónica?
- ¿El 21% de IVA aplica a todo el catálogo?
- Probar en la impresora real (IT03) que el ticket corte al final sin
  tirar papel de más.

## Operaciones sobre los datos (`supabase/operaciones/`)

Scripts de una sola vez que borran o corrigen datos, no esquema. Están
fuera de `migrations/` para que no se reapliquen en una base nueva. Se
corren a mano desde el SQL Editor de Supabase, siempre con un backup
previo (Reportes → Descargar backup).

- `2026-08-26_limpiar_datos_de_prueba.sql`: vació los datos de prueba
  antes de cargar el catálogo real. Conservó usuarios y notas.
