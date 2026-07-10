-- =====================================================================
-- COMPRAS APP - Migración Etapa 4 (rendimiento)
-- Ejecuta este archivo completo en el SQL Editor de Supabase
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Índices que aceleran los filtros y cruces más usados
-- ---------------------------------------------------------------------
create index if not exists idx_pedidos_co_fecha on pedidos(co, fecha);
create index if not exists idx_pedidos_co_cliente on pedidos(co, razon_social_cliente_despacho);
create index if not exists idx_pedidos_co_referencia on pedidos(co, referencia);
create index if not exists idx_pedidos_cliente_factura_sucursal on pedidos(cliente_factura, sucursal_despacho);
create index if not exists idx_clientes_codigo_sucursal2 on clientes(codigo, sucursal);

-- ---------------------------------------------------------------------
-- 2. Convertir la clasificación Pareto en vistas MATERIALIZADAS.
--    Antes se recalculaban por completo cada vez que alguien abría
--    Pendientes o el Dashboard (por eso iba tan lento / se agotaba el
--    tiempo de espera). Ahora se calculan una sola vez y se guardan;
--    se actualizan con la función refrescar_pareto() de más abajo.
-- ---------------------------------------------------------------------
drop view if exists v_pendientes;
drop view if exists v_pedidos_dashboard;
drop view if exists v_pareto_cliente;
drop view if exists v_pareto_referencia;

create materialized view mv_pareto_cliente as
  with base as (
    select co, razon_social_cliente_despacho as cliente, sum(valor_subtotal) as valor
    from v_pedidos_mes_actual
    group by co, razon_social_cliente_despacho
  ),
  ranked as (
    select co, cliente, valor,
      sum(valor) over (partition by co order by valor desc
                        rows between unbounded preceding and current row)
        / nullif(sum(valor) over (partition by co), 0) * 100 as pct_acumulado
    from base
  )
  select co, cliente,
    case
      when pct_acumulado <= 80 then 'A'
      when pct_acumulado <= 95 then 'B'
      when pct_acumulado <= 99 then 'C'
      else 'D'
    end as clasificacion_cliente
  from ranked;

create unique index if not exists idx_mv_pareto_cliente on mv_pareto_cliente(co, cliente);

create materialized view mv_pareto_referencia as
  with base as (
    select co, referencia, sum(valor_subtotal) as valor
    from v_pedidos_mes_actual
    group by co, referencia
  ),
  ranked as (
    select co, referencia, valor,
      sum(valor) over (partition by co order by valor desc
                        rows between unbounded preceding and current row)
        / nullif(sum(valor) over (partition by co), 0) * 100 as pct_acumulado
    from base
  )
  select co, referencia,
    case
      when pct_acumulado <= 80 then 'A'
      when pct_acumulado <= 95 then 'B'
      when pct_acumulado <= 99 then 'C'
      else 'D'
    end as clasificacion_referencia
  from ranked;

create unique index if not exists idx_mv_pareto_referencia on mv_pareto_referencia(co, referencia);

-- ---------------------------------------------------------------------
-- 3. Función para refrescar las vistas materializadas. Se llama
--    automáticamente después de cada importación de Pedidos, y también
--    se puede llamar manualmente con un botón "Actualizar clasificación".
-- ---------------------------------------------------------------------
create or replace function refrescar_pareto()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently mv_pareto_cliente;
  refresh materialized view concurrently mv_pareto_referencia;
end;
$$;

-- Primer refresco (para que no queden vacías)
refresh materialized view mv_pareto_cliente;
refresh materialized view mv_pareto_referencia;

-- ---------------------------------------------------------------------
-- 4. Volver a crear las vistas que dependen de la clasificación, ahora
--    apuntando a las versiones materializadas (mucho más rápidas).
-- ---------------------------------------------------------------------
create or replace view v_pendientes
  with (security_invoker = true) as
  select
    p.id,
    p.co,
    p.fecha_actualizacion,
    p.nro_documento,
    p.bodega,
    p.proveedor,
    p.referencia,
    p.desc_item,
    p.cant_pedida,
    p.cant_remision,
    p.cant_pendiente,
    p.valor_subtotal,
    p.razon_social_cliente_despacho,
    p.nombre_vendedor,
    p.motivo_id,
    m.nombre as motivo_nombre,
    p.responsable_motivo,
    p.motivo_asignado_en,
    pc.clasificacion_cliente,
    pr.clasificacion_referencia
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  left join mv_pareto_cliente pc on pc.co = p.co and pc.cliente = p.razon_social_cliente_despacho
  left join mv_pareto_referencia pr on pr.co = p.co and pr.referencia = p.referencia
  where p.cant_pendiente > 0;

create or replace view v_pedidos_dashboard
  with (security_invoker = true) as
  select
    p.id,
    p.co,
    p.fecha,
    p.fecha_actualizacion,
    p.nro_documento,
    p.bodega,
    p.proveedor,
    p.referencia,
    p.desc_item,
    p.cant_pedida,
    p.cant_remision,
    p.cant_pendiente,
    p.valor_subtotal,
    p.cliente_factura,
    p.razon_social_cliente_despacho,
    p.nombre_vendedor,
    p.canal,
    p.sucursal_despacho,
    m.nombre as motivo_nombre,
    p.responsable_motivo,
    pc.clasificacion_cliente,
    pr.clasificacion_referencia,
    c.canal as cliente_canal,
    c.zona as cliente_zona,
    c.razon_social_sucursal
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  left join mv_pareto_cliente pc on pc.co = p.co and pc.cliente = p.razon_social_cliente_despacho
  left join mv_pareto_referencia pr on pr.co = p.co and pr.referencia = p.referencia
  left join clientes c
    on c.codigo = p.cliente_factura
   and c.sucursal = p.sucursal_despacho;

-- ---------------------------------------------------------------------
-- 5. Permitir que cualquier usuario autenticado ejecute el refresco
--    manual (por ejemplo, desde un botón "Actualizar clasificación").
-- ---------------------------------------------------------------------
grant execute on function refrescar_pareto() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Aumentar el tiempo máximo de espera de las consultas para este
--    proyecto (por defecto Supabase corta las consultas muy largas).
--    Si tu plan de Supabase no te deja ejecutar esto, hazlo desde
--    Project Settings > Database > "Statement timeout" en el panel web.
-- ---------------------------------------------------------------------
alter role authenticator set statement_timeout = '30s';
