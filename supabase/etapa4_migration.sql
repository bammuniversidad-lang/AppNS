-- =====================================================================
-- COMPRAS APP - Migración Etapa 4: RENDIMIENTO
-- Ejecuta este archivo completo en el SQL Editor de Supabase
-- (después de schema.sql, fix_rls_profiles.sql y etapa2_migration.sql)
-- =====================================================================
-- Por qué: Dashboard y Pendientes se estaban demorando mucho (y a veces
-- daban "canceling statement due to statement timeout") porque la
-- clasificación Pareto (A/B/C/D) se recalculaba EN VIVO, con funciones de
-- ventana, cada vez que alguien abría la página — sin importar cuántos
-- pedidos hubiera. Esta migración la precalcula una sola vez por
-- importación y la guarda en la tabla, además de mover los cálculos del
-- Dashboard al servidor (antes se traían todas las filas al navegador).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas de clasificación precalculadas en "pedidos"
-- ---------------------------------------------------------------------
alter table pedidos add column if not exists clasificacion_cliente text;
alter table pedidos add column if not exists clasificacion_referencia text;

-- ---------------------------------------------------------------------
-- 2. Índices para acelerar los filtros, joins y agrupaciones más usados
-- ---------------------------------------------------------------------
create index if not exists idx_pedidos_co_nrodoc on pedidos(co, nro_documento);
create index if not exists idx_pedidos_co_referencia on pedidos(co, referencia);
create index if not exists idx_pedidos_fecha_actualizacion on pedidos(fecha_actualizacion);
create index if not exists idx_pedidos_motivo_id on pedidos(motivo_id);
create index if not exists idx_pedidos_responsable on pedidos(responsable_motivo);
create index if not exists idx_pedidos_cliente_sucursal on pedidos(cliente_factura, sucursal_despacho);
create index if not exists idx_pedidos_proveedor on pedidos(proveedor);
create index if not exists idx_pedidos_vendedor on pedidos(nombre_vendedor);
create index if not exists idx_pedidos_razon_social on pedidos(razon_social_cliente_despacho);

-- ---------------------------------------------------------------------
-- 3. Función que recalcula la clasificación Pareto (se llama UNA VEZ al
--    terminar cada importación de Pedidos, no en cada consulta)
-- ---------------------------------------------------------------------
create or replace function recalcular_clasificaciones()
returns void
language plpgsql
as $$
begin
  with base as (
    select id, co, razon_social_cliente_despacho as cliente, referencia, valor_subtotal
    from pedidos
    where date_trunc('month', coalesce(fecha, fecha_actualizacion)) = date_trunc('month', current_date)
  ),
  valor_cliente as (
    select co, cliente, sum(valor_subtotal) as valor
    from base
    group by co, cliente
  ),
  clasif_cliente as (
    select co, cliente,
      case
        when sum(valor) over (partition by co order by valor desc rows between unbounded preceding and current row)
             / nullif(sum(valor) over (partition by co), 0) * 100 <= 80 then 'A'
        when sum(valor) over (partition by co order by valor desc rows between unbounded preceding and current row)
             / nullif(sum(valor) over (partition by co), 0) * 100 <= 95 then 'B'
        when sum(valor) over (partition by co order by valor desc rows between unbounded preceding and current row)
             / nullif(sum(valor) over (partition by co), 0) * 100 <= 99 then 'C'
        else 'D'
      end as clasificacion
    from valor_cliente
  ),
  valor_referencia as (
    select co, referencia, sum(valor_subtotal) as valor
    from base
    group by co, referencia
  ),
  clasif_referencia as (
    select co, referencia,
      case
        when sum(valor) over (partition by co order by valor desc rows between unbounded preceding and current row)
             / nullif(sum(valor) over (partition by co), 0) * 100 <= 80 then 'A'
        when sum(valor) over (partition by co order by valor desc rows between unbounded preceding and current row)
             / nullif(sum(valor) over (partition by co), 0) * 100 <= 95 then 'B'
        when sum(valor) over (partition by co order by valor desc rows between unbounded preceding and current row)
             / nullif(sum(valor) over (partition by co), 0) * 100 <= 99 then 'C'
        else 'D'
      end as clasificacion
    from valor_referencia
  )
  update pedidos p
  set clasificacion_cliente = cc.clasificacion,
      clasificacion_referencia = cr.clasificacion
  from base b
  left join clasif_cliente cc on cc.co = b.co and cc.cliente = b.cliente
  left join clasif_referencia cr on cr.co = b.co and cr.referencia = b.referencia
  where p.id = b.id;
end;
$$;

-- Permitir que cualquier usuario autenticado la ejecute (se llama desde
-- la app justo después de importar Pedidos)
grant execute on function recalcular_clasificaciones() to authenticated;

-- ---------------------------------------------------------------------
-- 4. v_pendientes: usar las columnas ya calculadas (sin joins pesados)
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
    p.clasificacion_cliente,
    p.clasificacion_referencia
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  where p.cant_pendiente > 0;

-- ---------------------------------------------------------------------
-- 5. v_pedidos_dashboard: usar las columnas ya calculadas
-- ---------------------------------------------------------------------
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
    p.clasificacion_cliente,
    p.clasificacion_referencia,
    c.canal as cliente_canal,
    c.zona as cliente_zona,
    c.razon_social_sucursal
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  left join clientes c
    on c.codigo = p.cliente_factura
   and c.sucursal = p.sucursal_despacho;

-- ---------------------------------------------------------------------
-- 6. Función de Dashboard: agrega EN EL SERVIDOR y devuelve un solo
--    jsonb (antes la app traía todas las filas al navegador y sumaba
--    ahí, lo cual era lento y pesado con muchos datos).
-- ---------------------------------------------------------------------
create or replace function obtener_dashboard(
  p_co text default null,
  p_co_list text[] default null,
  p_fecha_inicio date default null,
  p_fecha_fin date default null,
  p_razon_social_sucursal text default null,
  p_vendedor text default null,
  p_proveedor text default null,
  p_desc_item text default null,
  p_canal text default null,
  p_zona text default null
)
returns jsonb
language sql
stable
as $$
  with base as (
    select p.*, c.canal as cliente_canal, c.zona as cliente_zona, c.razon_social_sucursal
    from pedidos p
    left join clientes c
      on c.codigo = p.cliente_factura
     and c.sucursal = p.sucursal_despacho
    where (p_co is null or p.co = p_co)
      and (p_co_list is null or p.co = any(p_co_list))
      and (p_fecha_inicio is null or p.fecha_actualizacion >= p_fecha_inicio)
      and (p_fecha_fin is null or p.fecha_actualizacion <= p_fecha_fin)
      and (p_vendedor is null or p.nombre_vendedor ilike '%' || p_vendedor || '%')
      and (p_proveedor is null or p.proveedor ilike '%' || p_proveedor || '%')
      and (p_desc_item is null or p.desc_item ilike '%' || p_desc_item || '%')
      and (p_canal is null or c.canal = p_canal)
      and (p_zona is null or c.zona = p_zona)
      and (p_razon_social_sucursal is null or c.razon_social_sucursal ilike '%' || p_razon_social_sucursal || '%')
  ),
  tarjetas as (
    select jsonb_build_object(
      'pedidos_totales', count(distinct (co, nro_documento)),
      'pedidos_con_pendientes', count(distinct (co, nro_documento)) filter (where cant_pendiente > 0),
      'lineas_totales', count(distinct (co, referencia, nro_documento)),
      'lineas_pendientes', count(distinct (co, referencia, nro_documento)) filter (where cant_pendiente > 0),
      'cantidad_total', coalesce(sum(cant_pedida), 0),
      'cantidad_pendiente', coalesce(sum(cant_pendiente), 0),
      'valor_total', coalesce(sum(valor_subtotal), 0),
      'valor_pendiente', coalesce(sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end), 0)
    ) as datos
    from base
  ),
  proveedor as (
    select coalesce(jsonb_agg(fila), '[]'::jsonb) as datos from (
      select proveedor,
        sum(valor_subtotal) as valor_solicitado,
        sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado
      from base group by proveedor
    ) fila
  ),
  vendedor as (
    select coalesce(jsonb_agg(fila), '[]'::jsonb) as datos from (
      select nombre_vendedor,
        sum(valor_subtotal) as valor_solicitado,
        sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado
      from base group by nombre_vendedor
    ) fila
  ),
  cliente as (
    select coalesce(jsonb_agg(fila), '[]'::jsonb) as datos from (
      select razon_social_cliente_despacho,
        sum(valor_subtotal) as valor_solicitado,
        sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado
      from base group by razon_social_cliente_despacho
    ) fila
  ),
  responsable as (
    select coalesce(jsonb_agg(fila), '[]'::jsonb) as datos from (
      select coalesce(responsable_motivo, '(sin asignar)') as responsable,
        sum(valor_subtotal) as valor,
        sum(cant_pedida) as cantidad_total,
        sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) as valor_pendiente
      from base group by coalesce(responsable_motivo, '(sin asignar)')
    ) fila
  ),
  motivo as (
    select coalesce(jsonb_agg(fila), '[]'::jsonb) as datos from (
      select coalesce(m.nombre, '(sin asignar)') as motivo,
        sum(b.valor_subtotal) as valor,
        sum(b.cant_pedida) as cantidad_total,
        sum(case when b.cant_pedida > 0 then (b.valor_subtotal / b.cant_pedida) * b.cant_pendiente else 0 end) as valor_pendiente
      from base b
      left join motivos m on m.id = b.motivo_id
      group by coalesce(m.nombre, '(sin asignar)')
    ) fila
  ),
  item_pendiente as (
    select coalesce(jsonb_agg(fila), '[]'::jsonb) as datos from (
      select desc_item,
        sum(cant_pendiente) as cantidad_pendiente,
        sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) as valor_pendiente
      from base
      where cant_pendiente > 0
      group by desc_item
    ) fila
  ),
  grafico_co as (
    select coalesce(jsonb_agg(fila), '[]'::jsonb) as datos from (
      select co,
        case when sum(valor_subtotal) > 0
          then round(100 * sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) / sum(valor_subtotal), 1)
          else 0 end as ns_valor
      from base group by co
    ) fila
  ),
  grafico_mes as (
    select coalesce(jsonb_agg(fila order by fila.mes), '[]'::jsonb) as datos from (
      select to_char(fecha_actualizacion, 'YYYY-MM') as mes,
        case when sum(valor_subtotal) > 0
          then round(100 * sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) / sum(valor_subtotal), 1)
          else 0 end as ns_valor
      from base
      where fecha_actualizacion is not null
      group by to_char(fecha_actualizacion, 'YYYY-MM')
    ) fila
  )
  select jsonb_build_object(
    'tarjetas', (select datos from tarjetas),
    'cuadro_proveedor', (select datos from proveedor),
    'cuadro_vendedor', (select datos from vendedor),
    'cuadro_cliente', (select datos from cliente),
    'cuadro_responsable', (select datos from responsable),
    'cuadro_motivo', (select datos from motivo),
    'cuadro_item_pendiente', (select datos from item_pendiente),
    'grafico_co', (select datos from grafico_co),
    'grafico_mes', (select datos from grafico_mes)
  );
$$;

grant execute on function obtener_dashboard(text, text[], date, date, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Función liviana para el filtro de C.O. (evita traer todas las
--    filas de pedidos al navegador solo para sacar los valores únicos)
-- ---------------------------------------------------------------------
create or replace function listar_cos_pedidos()
returns table(co text)
language sql
stable
as $$
  select distinct co from pedidos order by co;
$$;

grant execute on function listar_cos_pedidos() to authenticated;

-- ---------------------------------------------------------------------
-- 8. Calcular la clasificación por primera vez para los datos que ya
--    tengas importados (después de esto, la app la recalcula sola en
--    cada importación de Pedidos)
-- ---------------------------------------------------------------------
select recalcular_clasificaciones();
