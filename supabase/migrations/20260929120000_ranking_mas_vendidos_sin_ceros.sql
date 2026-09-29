-- "Más vendidos" no debe rellenarse con productos que no vendieron nada:
-- con poco historial el top quedaba lleno de productos en $0 ordenados
-- por nombre. Los sin ventas solo aparecen en "menos vendidos" (asc).
-- Mismo cuerpo que 20260929110000_reportes_periodo.sql + el filtro final.

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
  -- Los más vendidos (desc) solo incluyen productos con ventas.
  where p_sentido = 'asc' or r.cantidad > 0
  order by
    (case when p_sentido = 'desc' then (case p_orden when 'cantidad' then r.cantidad else r.monto end) end) desc nulls last,
    (case when p_sentido = 'asc' then (case p_orden when 'cantidad' then r.cantidad else r.monto end) end) asc nulls last,
    r.nombre
  limit greatest(p_limite, 1);
end;
$$;
