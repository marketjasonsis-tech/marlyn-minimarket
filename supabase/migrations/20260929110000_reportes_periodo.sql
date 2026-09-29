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
