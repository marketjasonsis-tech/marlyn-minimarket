-- Reportado por Jason (2026-10-27): los colaboradores no pueden cerrar
-- la caja. Causa: FormularioCerrarCaja.tsx hacía un update directo a
-- turnos_caja, y en Postgres un update con where también exige que la
-- fila YA MODIFICADA siga siendo visible por la policy de select. Desde
-- 20260824120000 la caja es compartida, pero el historial de turnos
-- cerrados sigue siendo privado (operador ve solo los que abrió él):
-- al pasar a 'cerrado', un turno que abrió otro (el dueño, o otro
-- colaborador) deja de ser visible para el operador que lo cierra, y
-- el update falla con "new row violates row-level security policy".
-- Solo andaba si el colaborador había abierto la caja él mismo.

-- 1) Quién cerró. Con la caja compartida, quien abre y quien cierra
-- pueden ser personas distintas, y un faltante es de quien contó el
-- cajón al cerrar. Los turnos cerrados antes de esta migración quedan
-- en null: no hay forma de saber quién los cerró.
alter table public.turnos_caja
add column cerrado_por uuid references public.perfiles (id);

-- 2) Se cierra con una función security definer (mismo criterio que el
-- resto del estado derivado de caja): cualquier usuario activo puede
-- cerrar el turno abierto, y cerrado_por sale de la sesión, no de lo
-- que mande el navegador. Los montos llegan igual que antes desde el
-- formulario; cerrado_en lo pone la base.
create or replace function public.cerrar_turno_caja(
  p_turno_id uuid,
  p_monto_declarado numeric,
  p_monto_calculado numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.auth_activo(), false) then
    raise exception 'No tenés una sesión activa para cerrar la caja';
  end if;

  if p_monto_declarado is null or p_monto_declarado < 0 then
    raise exception 'El efectivo contado tiene que ser mayor o igual a cero';
  end if;

  update public.turnos_caja
  set estado = 'cerrado',
      monto_cierre_declarado = p_monto_declarado,
      monto_cierre_calculado = p_monto_calculado,
      cerrado_en = now(),
      cerrado_por = auth.uid()
  where id = p_turno_id
    and estado = 'abierto';

  -- Antes, cerrar un turno que ya había cerrado otro (desde otra PC)
  -- no actualizaba ninguna fila y la pantalla igual mostraba "Caja
  -- cerrada" con una diferencia que no se guardó en ningún lado.
  if not found then
    raise exception 'Esta caja ya estaba cerrada';
  end if;
end;
$$;

-- 3) El colaborador ve en su historial los turnos que abrió y también
-- los que cerró él. Los demás turnos cerrados siguen siendo privados.
drop policy "turnos_caja_select_abierto_o_propio_o_dueño" on public.turnos_caja;

create policy "turnos_caja_select_abierto_o_propio_o_dueño" on public.turnos_caja
for select to authenticated
using (
  coalesce(public.auth_activo(), false)
  and (
    estado = 'abierto'
    or coalesce(public.auth_rol(), '') = 'dueño'
    or usuario_id = auth.uid()
    or cerrado_por = auth.uid()
  )
);

-- 4) Auditoría: el cierre (y su faltante o sobrante) figura a nombre de
-- quien cerró. Para los cierres viejos, sin cerrado_por, se mantiene
-- quien abrió, como hasta ahora. El resto de la vista queda igual que
-- en 20260826100000.
create or replace view public.auditoria_movimientos
with (security_invoker = true)
as
select * from (
  select
    ms.id,
    ms.creado_en as fecha,
    ms.usuario_id,
    case ms.tipo
      when 'venta' then 'stock_venta'
      when 'anulacion_venta' then 'stock_anulacion'
      when 'ingreso' then 'stock_entrada'
      when 'ajuste' then 'stock_salida'
      else 'stock_merma'
    end as tipo,
    p.nombre || coalesce(' — ' || ms.motivo, '') as descripcion,
    ms.cantidad as monto
  from public.movimientos_stock ms
  join public.productos p on p.id = ms.producto_id

  union all

  select
    mcc.id,
    mcc.creado_en as fecha,
    mcc.creado_por as usuario_id,
    case mcc.tipo
      when 'recargo' then 'cta_cte_recargo'
      when 'pago' then 'cta_cte_pago'
      when 'actualizacion' then 'cta_cte_actualizacion'
      else 'cta_cte_fiado'
    end as tipo,
    c.nombre || coalesce(' — ' || mcc.nota, '') as descripcion,
    mcc.monto
  from public.movimientos_cuenta_corriente mcc
  join public.clientes c on c.id = mcc.cliente_id

  union all

  select
    mc.id,
    mc.creado_en as fecha,
    mc.usuario_id,
    case mc.tipo when 'ingreso' then 'caja_ingreso' else 'caja_egreso' end as tipo,
    mc.motivo as descripcion,
    mc.monto
  from public.movimientos_caja mc

  union all

  select
    v.id,
    v.anulada_en as fecha,
    v.anulada_por as usuario_id,
    'venta_anulada' as tipo,
    'Venta #' || v.numero || coalesce(' — ' || v.motivo_anulacion, '') as descripcion,
    v.total as monto
  from public.ventas v
  where v.estado = 'anulada'

  union all

  -- monto = declarado - calculado: negativo es faltante (la señal más
  -- directa de "algo raro pasó en este turno"), positivo es que sobró.
  select
    tc.id,
    tc.cerrado_en as fecha,
    coalesce(tc.cerrado_por, tc.usuario_id) as usuario_id,
    'turno_cierre' as tipo,
    'Cierre de turno' as descripcion,
    coalesce(tc.monto_cierre_declarado, 0) - coalesce(tc.monto_cierre_calculado, 0) as monto
  from public.turnos_caja tc
  where tc.estado = 'cerrado'
) todos
where coalesce(public.auth_rol(), '') = 'dueño';
