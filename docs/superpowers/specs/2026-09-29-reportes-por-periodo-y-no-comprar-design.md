# Reportes por período y lista "no comprar más" — diseño

Fecha: 2026-09-29. Pedido de Jason (dueño).

## Objetivo

1. Poder ver las ventas y el ranking de productos por **período** (fecha de
   inicio y fin, o atajos como "último mes" / "último año"), al estilo de las
   Métricas de MercadoPago, y saber qué productos se venden más y cuáles menos
   en rangos largos (ej. 10 meses). Solo dueño.
2. Tener una lista de productos que **no se vuelven a comprar**, con el motivo,
   y que se advierta al armar un pedido a un proveedor o al mirar alertas de
   stock.

## Fuera de alcance

- No se toca el dashboard diario actual (`PanelReportes`): queda tal cual.
- No se guarda costo histórico por venta: el Balance sigue usando el costo
  actual del producto (igual que el diario).
- La advertencia de "no comprar" **no bloquea** nada.
- No se crea una lista separada de nombres/códigos: se marca el producto del
  catálogo (los productos con historia ya se conservan como `activo = false`).

## 1. Reportes por período

### UI

- `/reportes` gana pestañas: **Diario** (actual, sin cambios) y **Períodos**.
  Ambas solo para el dueño, con el mismo control de acceso que hoy.
- **Selector de período:** atajos (Últimos 7 días, Últimos 30 días, Este mes,
  Mes pasado, Últimos 6 meses, Último año) y "Personalizado" con inicio y fin.
- **Comparación:** "Sin comparar" (por defecto) o "Período anterior" (mismo
  largo, inmediatamente antes).
- **Subpestaña Ventas:** total vendido, % de variación contra el período
  anterior (si se compara), gráfico de línea de la evolución, cantidad de
  ventas, ticket promedio y balance (margen bruto).
  - Granularidad del gráfico automática: por día hasta 31 días, por semana
    hasta ~6 meses, por mes más allá.
- **Subpestaña Productos:** ranking de más vendidos y de menos vendidos, con
  interruptor unidades / monto (por defecto monto, porque hay productos por
  kg). Los menos vendidos incluyen productos activos con cero ventas.
  Top 10, ampliable a 25 o 50. Cada fila tiene el botón "No comprar más".

### Datos

- Dos funciones SQL `SECURITY INVOKER` (RLS aplica), que agregan en la base
  para no chocar con el tope de 1000 filas de Supabase:
  - `reporte_periodo(desde, hasta, granularidad)` → serie temporal, total,
    cantidad de ventas, ticket promedio, balance.
  - `ranking_productos(desde, hasta)` → por producto: unidades, monto, y
    productos activos sin ventas con cero.
- Solo ventas `estado = 'confirmada'`.
- Límites de día con la misma zona horaria que `limitesDelDia`
  (`src/modulos/reportes/consultas/calculos.ts`).
- Lógica pura nueva (intervalo anterior, variación %, elección de
  granularidad) en `calculos.ts`, con tests.

## 2. Lista "no comprar más"

### Base de datos

Migración sobre `productos`: `no_comprar boolean not null default false`,
`no_comprar_motivo text`, `no_comprar_desde timestamptz`. Marcar o quitar solo
lo puede hacer el dueño (RLS / regla ya usada para rol operador).

### UI

- **Marcar / quitar:** desde el ranking (botón por fila) y desde Editar
  producto en Stock (interruptor + motivo opcional). Solo dueño.
- **Listado:** sección "No comprar más" dentro de Proveedores, con producto,
  proveedor, motivo, fecha y botón "Quitar".
- **Pedidos:** en `PanelPedidoProveedor`, los productos marcados llevan
  etiqueta roja con el motivo; al tildar uno aparece un aviso (no bloquea).
- **Alertas de stock bajo** (`PanelAlertasStock`): misma etiqueta, para no
  reponer por reflejo un producto malo.

## Pruebas

- Vitest: intervalo anterior, variación %, granularidad, formato del ranking.
- `*rls.test.ts`: las funciones SQL devuelven los agregados esperados y el
  colaborador no puede marcar `no_comprar`.

## Orden de construcción sugerido

1. Migración `no_comprar` + tipos + marcar en Stock + etiqueta en pedidos y
   alertas + listado en Proveedores.
2. Funciones SQL de reportes + lógica pura + pestaña Períodos (Ventas).
3. Subpestaña Productos con ranking y botón "No comprar más".
