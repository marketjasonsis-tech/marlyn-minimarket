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
