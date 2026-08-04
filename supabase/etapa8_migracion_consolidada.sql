-- =====================================================================
-- COMPRAS APP - Migración Etapa 8 (CONSOLIDADA Y DEFINITIVA)
-- Ejecuta este archivo completo en el SQL Editor de Supabase.
-- =====================================================================
-- Por qué existe este archivo: la migración de la Etapa 5 fallaba a
-- mitad de camino (intentaba borrar una vista materializada sin
-- CASCADE, de la que dependían otras vistas), y Supabase corta la
-- ejecución ahí mismo. Como consecuencia, las Etapas 5, 6 y 7 quedaron
-- aplicadas solo a medias: por eso la clasificación seguía en blanco,
-- NS Total no traía datos, y el Dashboard seguía sin funcionar.
--
-- Este script es seguro de ejecutar sin importar en qué paso te hayas
-- quedado: primero limpia todo lo que pueda estorbar (con CASCADE) y
-- luego recrea, en el orden correcto, el estado final correcto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Limpieza: quitar vistas y objetos que puedan tener dependencias
--    cruzadas de intentos anteriores.
-- ---------------------------------------------------------------------
drop view if exists v_pendientes cascade;
drop view if exists v_pedidos_dashboard cascade;
drop view if exists v_pedidos_con_cliente cascade;
drop view if exists v_pedidos_clasificados cascade;
drop view if exists v_pareto_cliente cascade;
drop view if exists v_pareto_referencia cascade;
drop view if exists v_pedidos_mes_actual cascade;
drop materialized view if exists mv_pareto_cliente cascade;
drop materialized view if exists mv_pareto_referencia cascade;
drop function if exists refrescar_pareto() cascade;
drop function if exists dashboard_completo(date,date,text[],text,text,text,text,text,text,text,text) cascade;
drop function if exists dash_filtrado(date,date,text[],text,text,text,text,text,text,text,text) cascade;
drop function if exists dash_filtrado_liviano(date,date,text[],text,text,text,text,text) cascade;
drop function if exists get_pedidos_cards(text[], date, date, boolean) cascade;
drop function if exists obtener_pareto_referencia(date, date, text[]) cascade;
drop function if exists obtener_pareto_cliente(date, date, text[]) cascade;
drop function if exists refrescar_resumen_mensual(text[]) cascade;
drop table if exists resumen_mensual_dashboard cascade;

-- ---------------------------------------------------------------------
-- 2. Clasificación Pareto: sobre el MES COMPLETO que contiene el rango
--    seleccionado, agrupando toda la base de pedidos, usando
--    Fecha actualización.
-- ---------------------------------------------------------------------
create or replace function obtener_pareto_cliente(
  fecha_inicio date default null,
  fecha_fin date default null,
  co_list text[] default null
)
returns jsonb
language sql
stable
as $$
  with rango as (
    select
      case when fecha_inicio is null then null else date_trunc('month', fecha_inicio)::date end as desde,
      case when fecha_fin is null then null else (date_trunc('month', fecha_fin) + interval '1 month' - interval '1 day')::date end as hasta
  ),
  base as (
    select p.co, p.razon_social_cliente_despacho as cliente, sum(p.valor_subtotal) as valor
    from pedidos p, rango r
    where (r.desde is null or p.fecha_actualizacion >= r.desde)
      and (r.hasta is null or p.fecha_actualizacion <= r.hasta)
      and (co_list is null or p.co = any(co_list))
    group by p.co, p.razon_social_cliente_despacho
  ),
  ranked as (
    select co, cliente, valor,
      sum(valor) over (partition by co order by valor desc
                        rows between unbounded preceding and current row)
        / nullif(sum(valor) over (partition by co), 0) * 100 as pct_acumulado
    from base
  ),
  clasificado as (
    select co, cliente,
      case
        when pct_acumulado <= 80 then 'A'
        when pct_acumulado <= 95 then 'B'
        when pct_acumulado <= 99 then 'C'
        else 'D'
      end as clasificacion_cliente
    from ranked
  )
  -- Se devuelve como un único jsonb (no como tabla/SETOF) a propósito:
  -- las consultas normales de Supabase limitan las tablas a 1000 filas
  -- por página, y aquí puede haber miles de clientes distintos. Un solo
  -- valor jsonb no tiene ese límite.
  select coalesce(jsonb_agg(jsonb_build_object('co', co, 'cliente', cliente, 'clasificacion_cliente', clasificacion_cliente)), '[]'::jsonb)
  from clasificado;
$$;

create or replace function obtener_pareto_referencia(
  fecha_inicio date default null,
  fecha_fin date default null,
  co_list text[] default null
)
returns jsonb
language sql
stable
as $$
  with rango as (
    select
      case when fecha_inicio is null then null else date_trunc('month', fecha_inicio)::date end as desde,
      case when fecha_fin is null then null else (date_trunc('month', fecha_fin) + interval '1 month' - interval '1 day')::date end as hasta
  ),
  base as (
    select p.co, p.desc_item as item, sum(p.valor_subtotal) as valor
    from pedidos p, rango r
    where (r.desde is null or p.fecha_actualizacion >= r.desde)
      and (r.hasta is null or p.fecha_actualizacion <= r.hasta)
      and (co_list is null or p.co = any(co_list))
    group by p.co, p.desc_item
  ),
  ranked as (
    select co, item, valor,
      sum(valor) over (partition by co order by valor desc
                        rows between unbounded preceding and current row)
        / nullif(sum(valor) over (partition by co), 0) * 100 as pct_acumulado
    from base
  ),
  clasificado as (
    select co, item,
      case
        when pct_acumulado <= 80 then 'A'
        when pct_acumulado <= 95 then 'B'
        when pct_acumulado <= 99 then 'C'
        else 'D'
      end as clasificacion_referencia
    from ranked
  )
  select coalesce(jsonb_agg(jsonb_build_object('co', co, 'item', item, 'clasificacion_referencia', clasificacion_referencia)), '[]'::jsonb)
  from clasificado;
$$;

grant execute on function obtener_pareto_cliente(date, date, text[]) to authenticated;
grant execute on function obtener_pareto_referencia(date, date, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Tarjetas (Pedidos/Líneas/Cantidad/Valor), usando Fecha actualización.
-- ---------------------------------------------------------------------
create or replace function get_pedidos_cards(
  co_list text[] default null,
  fecha_inicio date default null,
  fecha_fin date default null,
  solo_sin_motivo boolean default false
)
returns table (
  pedidos_totales bigint, pedidos_con_pendientes bigint, ns_pedidos numeric,
  lineas_totales bigint, lineas_pendientes bigint, ns_lineas numeric,
  cantidad_total numeric, cantidad_pendiente numeric, ns_cantidad numeric,
  valor_total numeric, valor_pendiente numeric, ns_valor numeric,
  ns_total numeric
)
language sql
stable
as $$
  with filtrado as materialized (
    select *
    from pedidos p
    where (co_list is null or p.co = any(co_list))
      and (fecha_inicio is null or p.fecha_actualizacion >= fecha_inicio)
      and (fecha_fin is null or p.fecha_actualizacion <= fecha_fin)
      and (not solo_sin_motivo or p.motivo_id is null)
  ),
  pedidos_unicos as (
    select co, nro_documento, bool_or(cant_pendiente > 0) as con_pendiente
    from filtrado
    group by co, nro_documento
  ),
  lineas_unicas as (
    select co, referencia, nro_documento, bool_or(cant_pendiente > 0) as con_pendiente
    from filtrado
    group by co, referencia, nro_documento
  ),
  agg as (
    select
      (select count(*) from pedidos_unicos) as pedidos_totales,
      (select count(*) from pedidos_unicos where con_pendiente) as pedidos_con_pendientes,
      (select count(*) from lineas_unicas) as lineas_totales,
      (select count(*) from lineas_unicas where con_pendiente) as lineas_pendientes,
      coalesce((select sum(cant_pedida) from filtrado), 0) as cantidad_total,
      coalesce((select sum(cant_pendiente) from filtrado), 0) as cantidad_pendiente,
      coalesce((select sum(valor_subtotal) from filtrado), 0) as valor_total,
      coalesce((select sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) from filtrado), 0) as valor_pendiente
  ),
  calc as (
    select
      pedidos_totales, pedidos_con_pendientes,
      case when pedidos_totales = 0 then 0 else round(1 - (pedidos_con_pendientes::numeric / pedidos_totales), 4) end as ns_pedidos,
      lineas_totales, lineas_pendientes,
      case when lineas_totales = 0 then 0 else round(1 - (lineas_pendientes::numeric / lineas_totales), 4) end as ns_lineas,
      cantidad_total, cantidad_pendiente,
      case when cantidad_total = 0 then 0 else round(1 - (cantidad_pendiente / cantidad_total), 4) end as ns_cantidad,
      valor_total, valor_pendiente,
      case when valor_total = 0 then 0 else round(1 - (valor_pendiente / valor_total), 4) end as ns_valor
    from agg
  )
  select
    pedidos_totales, pedidos_con_pendientes, ns_pedidos,
    lineas_totales, lineas_pendientes, ns_lineas,
    cantidad_total, cantidad_pendiente, ns_cantidad,
    valor_total, valor_pendiente, ns_valor,
    round(((ns_valor + ns_cantidad + ns_lineas) * 0.3) + (ns_pedidos * 0.1), 4) as ns_total
  from calc;
$$;

grant execute on function get_pedidos_cards(text[], date, date, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Vistas de Pendientes y del Dashboard (sin columnas de
--    clasificación: esa se pide aparte con obtener_pareto_cliente /
--    obtener_pareto_referencia, para que respete el mes seleccionado).
-- ---------------------------------------------------------------------
create or replace view v_pendientes
  with (security_invoker = true) as
  select
    p.id, p.co, p.fecha_actualizacion, p.nro_documento, p.bodega, p.proveedor,
    p.referencia, p.desc_item, p.cant_pedida, p.cant_remision, p.cant_pendiente,
    p.valor_subtotal, p.razon_social_cliente_despacho, p.nombre_vendedor,
    p.motivo_id, m.nombre as motivo_nombre, p.responsable_motivo, p.motivo_asignado_en
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  where p.cant_pendiente > 0;

create or replace view v_pedidos_dashboard
  with (security_invoker = true) as
  select
    p.id, p.co, p.fecha, p.fecha_actualizacion, p.nro_documento, p.bodega, p.proveedor,
    p.referencia, p.desc_item, p.cant_pedida, p.cant_remision, p.cant_pendiente, p.valor_subtotal,
    p.cliente_factura, p.razon_social_cliente_despacho, p.nombre_vendedor, p.canal, p.sucursal_despacho,
    m.nombre as motivo_nombre, p.responsable_motivo,
    c.canal as cliente_canal, c.zona as cliente_zona, c.razon_social_sucursal
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  left join clientes c on c.codigo = p.cliente_factura and c.sucursal = p.sucursal_despacho;

-- ---------------------------------------------------------------------
-- 5. Función interna de filtros compartidos por el Dashboard.
-- ---------------------------------------------------------------------
create or replace function dash_filtrado(
  p_fecha_inicio date, p_fecha_fin date, p_co_list text[],
  p_razon_social_sucursal text, p_vendedor text, p_proveedor text, p_desc_item text,
  p_canal text, p_zona text,
  p_cross_campo text, p_cross_valor text
)
returns table (
  co text, referencia text, nro_documento text, desc_item text,
  cant_pedida numeric, cant_remision numeric, cant_pendiente numeric, valor_subtotal numeric,
  proveedor text, nombre_vendedor text, razon_social_cliente_despacho text,
  motivo_nombre text, responsable_motivo text, fecha_actualizacion date
)
language plpgsql
stable
as $$
begin
  return query
  select p.co, p.referencia, p.nro_documento, p.desc_item, p.cant_pedida, p.cant_remision,
         p.cant_pendiente, p.valor_subtotal, p.proveedor, p.nombre_vendedor,
         p.razon_social_cliente_despacho, m.nombre, p.responsable_motivo, p.fecha_actualizacion
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  left join clientes c on c.codigo = p.cliente_factura and c.sucursal = p.sucursal_despacho
  where (p_fecha_inicio is null or p.fecha_actualizacion >= p_fecha_inicio)
    and (p_fecha_fin is null or p.fecha_actualizacion <= p_fecha_fin)
    and (p_co_list is null or p.co = any(p_co_list))
    and (p_razon_social_sucursal is null or p_razon_social_sucursal = '' or c.razon_social_sucursal ilike '%'||p_razon_social_sucursal||'%')
    and (p_vendedor is null or p_vendedor = '' or p.nombre_vendedor ilike '%'||p_vendedor||'%')
    and (p_proveedor is null or p_proveedor = '' or p.proveedor ilike '%'||p_proveedor||'%')
    and (p_desc_item is null or p_desc_item = '' or p.desc_item ilike '%'||p_desc_item||'%')
    and (p_canal is null or p_canal = '' or c.canal = p_canal)
    and (p_zona is null or p_zona = '' or c.zona = p_zona)
    and (
      p_cross_campo is null or p_cross_campo = ''
      or (p_cross_campo = 'proveedor' and p.proveedor = p_cross_valor)
      or (p_cross_campo = 'nombre_vendedor' and p.nombre_vendedor = p_cross_valor)
      or (p_cross_campo = 'razon_social_cliente_despacho' and p.razon_social_cliente_despacho = p_cross_valor)
      or (p_cross_campo = 'responsable_motivo' and p.responsable_motivo = p_cross_valor)
      or (p_cross_campo = 'motivo_nombre' and m.nombre = p_cross_valor)
      or (p_cross_campo = 'desc_item' and p.desc_item = p_cross_valor)
      or (p_cross_campo = 'co' and p.co = p_cross_valor)
      or (p_cross_campo = 'dia' and p.fecha_actualizacion::text = p_cross_valor)
      -- clasificacion_referencia no es una columna real de pedidos (se
      -- calcula más adelante); aquí no se filtra por ella, se deja pasar
      -- todo y dashboard_completo() la aplica después de clasificar.
      or (p_cross_campo = 'clasificacion_referencia')
    );
end;
$$;

grant execute on function dash_filtrado(date,date,text[],text,text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 5b. Versión liviana de dash_filtrado, SIN los left join a motivos y
--     clientes. Se usa solo para el gráfico de tendencia mensual (24
--     meses) y la comparación con el año anterior, que no necesitan
--     esos datos — evita dos joins de más sobre una tabla grande.
-- ---------------------------------------------------------------------
create or replace function dash_filtrado_liviano(
  p_fecha_inicio date, p_fecha_fin date, p_co_list text[],
  p_vendedor text, p_proveedor text, p_desc_item text,
  p_cross_campo text, p_cross_valor text
)
returns table (
  co text, nro_documento text, referencia text,
  cant_pedida numeric, cant_remision numeric, cant_pendiente numeric, valor_subtotal numeric,
  fecha_actualizacion date
)
language sql
stable
as $$
  select p.co, p.nro_documento, p.referencia, p.cant_pedida, p.cant_remision, p.cant_pendiente,
         p.valor_subtotal, p.fecha_actualizacion
  from pedidos p
  where (p_fecha_inicio is null or p.fecha_actualizacion >= p_fecha_inicio)
    and (p_fecha_fin is null or p.fecha_actualizacion <= p_fecha_fin)
    and (p_co_list is null or p.co = any(p_co_list))
    and (p_vendedor is null or p_vendedor = '' or p.nombre_vendedor ilike '%'||p_vendedor||'%')
    and (p_proveedor is null or p_proveedor = '' or p.proveedor ilike '%'||p_proveedor||'%')
    and (p_desc_item is null or p_desc_item = '' or p.desc_item ilike '%'||p_desc_item||'%')
    and (
      p_cross_campo is null or p_cross_campo = ''
      or (p_cross_campo = 'proveedor' and p.proveedor = p_cross_valor)
      or (p_cross_campo = 'nombre_vendedor' and p.nombre_vendedor = p_cross_valor)
      or (p_cross_campo = 'razon_social_cliente_despacho' and p.razon_social_cliente_despacho = p_cross_valor)
      or (p_cross_campo = 'responsable_motivo' and p.responsable_motivo = p_cross_valor)
      or (p_cross_campo = 'desc_item' and p.desc_item = p_cross_valor)
      or (p_cross_campo = 'co' and p.co = p_cross_valor)
      or (p_cross_campo = 'dia' and p.fecha_actualizacion::text = p_cross_valor)
      -- motivo_nombre y clasificacion_referencia necesitan un join que
      -- esta versión liviana no hace; para estos dos casos puntuales el
      -- gráfico mensual y el de año anterior no se filtran (se ven
      -- completos), a cambio de que el resto sea más rápido.
      or (p_cross_campo = 'motivo_nombre')
      or (p_cross_campo = 'clasificacion_referencia')
    );
$$;

grant execute on function dash_filtrado_liviano(date,date,text[],text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Función principal del Dashboard: tarjetas + NS Total, los 6
--    cuadros, y los 3 gráficos, todo en una sola consulta.
-- ---------------------------------------------------------------------
create or replace function dashboard_completo(
  p_fecha_inicio date default null,
  p_fecha_fin date default null,
  p_co_list text[] default null,
  p_razon_social_sucursal text default null,
  p_vendedor text default null,
  p_proveedor text default null,
  p_desc_item text default null,
  p_canal text default null,
  p_zona text default null,
  p_cross_campo text default null,
  p_cross_valor text default null
)
returns jsonb
language sql
stable
as $$
  with base as materialized (
    select * from dash_filtrado(
      p_fecha_inicio, p_fecha_fin, p_co_list, p_razon_social_sucursal, p_vendedor,
      p_proveedor, p_desc_item, p_canal, p_zona, p_cross_campo, p_cross_valor
    )
  ),
  item_agg as materialized (
    select desc_item, sum(valor_subtotal) as valor
    from base
    where desc_item is not null
    group by desc_item
  ),
  item_ranked as (
    select desc_item, valor,
      row_number() over (order by valor desc) as rn,
      count(*) over () as total_n,
      sum(valor) over (order by valor desc rows between unbounded preceding and current row) as acumulado,
      sum(valor) over () as total_valor
    from item_agg
  ),
  item_pct as materialized (
    -- Un solo cálculo de participación/acumulado por ítem, que se
    -- reutiliza para clasificar (Cuadro 8), para el filtro cruzado por
    -- clasificación, y para la curva de Pareto (Gráfico 5) — así se
    -- calcula una sola vez en toda la función.
    select desc_item, rn,
      round(rn::numeric / nullif(total_n, 0) * 100, 2) as pct_items,
      round(acumulado / nullif(total_valor, 0) * 100, 2) as pct_valor,
      case
        when round(acumulado / nullif(total_valor, 0) * 100, 2) <= 80 then 'A'
        when round(acumulado / nullif(total_valor, 0) * 100, 2) <= 95 then 'B'
        when round(acumulado / nullif(total_valor, 0) * 100, 2) <= 99 then 'C'
        else 'D'
      end as clasificacion
    from item_ranked
  ),
  curva_muestreada as (
    -- Se toma un solo punto por cada entero de % de productos (el último
    -- dentro de ese entero), para no mandar miles de puntos al navegador.
    select distinct on (floor(pct_items)) floor(pct_items) as bucket, pct_items, pct_valor
    from item_pct
    order by floor(pct_items), rn desc
  ),
  umbrales_pareto as (
    select
      min(pct_items) filter (where pct_valor >= 80) as x_a,
      min(pct_items) filter (where pct_valor >= 95) as x_b,
      min(pct_items) filter (where pct_valor >= 99) as x_c
    from item_pct
  ),
  -- "base_final" es la que usan todas las tarjetas, cuadros y el
  -- gráfico por C.O.: si el filtro cruzado es por clasificación de
  -- referencia, aquí se aplica (dash_filtrado no puede aplicarlo
  -- directamente porque la clasificación no es una columna de pedidos,
  -- se calcula arriba). Si no es ese el filtro cruzado, queda igual a
  -- "base". La curva de Pareto y sus umbrales SIEMPRE usan "base" sin
  -- este filtro, para que la curva no desaparezca al hacer clic en una
  -- zona.
  base_final as materialized (
    select b.*, ip.clasificacion as clasificacion_referencia
    from base b
    left join item_pct ip on ip.desc_item = b.desc_item
    where p_cross_campo is distinct from 'clasificacion_referencia'
       or ip.clasificacion = p_cross_valor
  ),
  pedidos_unicos as (
    -- Reemplaza "count(distinct (co, nro_documento))": agrupar primero y
    -- contar después es mucho más rápido que un COUNT DISTINCT compuesto
    -- cuando hay cientos de miles de filas.
    select co, nro_documento, bool_or(cant_pendiente > 0) as con_pendiente
    from base_final
    group by co, nro_documento
  ),
  lineas_unicas as (
    select co, referencia, nro_documento, bool_or(cant_pendiente > 0) as con_pendiente
    from base_final
    group by co, referencia, nro_documento
  ),
  tarjetas_calc as (
    select
      (select count(*) from pedidos_unicos) as pedidos_totales,
      (select count(*) from pedidos_unicos where con_pendiente) as pedidos_con_pendientes,
      (select count(*) from lineas_unicas) as lineas_totales,
      (select count(*) from lineas_unicas where con_pendiente) as lineas_pendientes,
      coalesce((select sum(cant_pedida) from base_final), 0) as cantidad_total,
      coalesce((select sum(cant_pendiente) from base_final), 0) as cantidad_pendiente,
      coalesce((select sum(valor_subtotal) from base_final), 0) as valor_total,
      coalesce((select sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) from base_final), 0) as valor_pendiente
  ),
  tarjetas as (
    select
      pedidos_totales, pedidos_con_pendientes,
      case when pedidos_totales = 0 then 0 else round(1 - (pedidos_con_pendientes::numeric / pedidos_totales), 4) end as ns_pedidos,
      lineas_totales, lineas_pendientes,
      case when lineas_totales = 0 then 0 else round(1 - (lineas_pendientes::numeric / lineas_totales), 4) end as ns_lineas,
      cantidad_total, cantidad_pendiente,
      case when cantidad_total = 0 then 0 else round(1 - (cantidad_pendiente / cantidad_total), 4) end as ns_cantidad,
      valor_total, valor_pendiente,
      case when valor_total = 0 then 0 else round(1 - (valor_pendiente / valor_total), 4) end as ns_valor
    from tarjetas_calc
  ),
  por_proveedor as (
    select coalesce(proveedor, '(sin dato)') as proveedor,
      sum(valor_subtotal) as valor_solicitado,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado
    from base_final group by proveedor
  ),
  por_vendedor as (
    select coalesce(nombre_vendedor, '(sin dato)') as nombre_vendedor,
      sum(valor_subtotal) as valor_solicitado,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado
    from base_final group by nombre_vendedor
  ),
  por_cliente as (
    select coalesce(razon_social_cliente_despacho, '(sin dato)') as razon_social_cliente_despacho,
      sum(valor_subtotal) as valor_solicitado,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado
    from base_final group by razon_social_cliente_despacho
  ),
  por_responsable as (
    select coalesce(responsable_motivo, '(sin asignar)') as responsable,
      sum(valor_subtotal) as valor,
      sum(cant_pedida) as cantidad_total,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) as valor_pendiente
    from base_final group by responsable_motivo
  ),
  por_motivo as (
    select coalesce(motivo_nombre, '(sin asignar)') as motivo,
      sum(valor_subtotal) as valor,
      sum(cant_pedida) as cantidad_total,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) as valor_pendiente
    from base_final group by motivo_nombre
  ),
  por_item as (
    select desc_item,
      sum(cant_pendiente) as cantidad_pendiente,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) as valor_pendiente
    from base_final
    where cant_pendiente > 0
    group by desc_item
  ),
  por_motivo_item as (
    select coalesce(motivo_nombre, '(sin asignar)') as motivo, desc_item,
      sum(cant_pendiente) as cantidad_pendiente,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) as valor_pendiente
    from base_final
    where cant_pendiente > 0
    group by motivo_nombre, desc_item
  ),
  por_clasificacion_referencia as (
    select
      coalesce(clasificacion_referencia, '(sin clasificar)') as clasificacion,
      count(distinct desc_item) as cantidad_referencias,
      sum(valor_subtotal) as valor_solicitado,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end) as valor_pendiente
    from base_final
    group by clasificacion_referencia
  ),
  por_co as (
    select co,
      sum(valor_subtotal) as valor_solicitado,
      sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_remision else 0 end) as valor_facturado
    from base_final group by co
  ),
  pedidos_unicos_dia as (
    select fecha_actualizacion, co, nro_documento, bool_or(cant_pendiente > 0) as con_pendiente
    from base_final
    where fecha_actualizacion is not null
    group by fecha_actualizacion, co, nro_documento
  ),
  lineas_unicas_dia as (
    select fecha_actualizacion, co, referencia, nro_documento, bool_or(cant_pendiente > 0) as con_pendiente
    from base_final
    where fecha_actualizacion is not null
    group by fecha_actualizacion, co, referencia, nro_documento
  ),
  pedidos_por_dia as (
    select fecha_actualizacion, count(*) as pedidos_totales, count(*) filter (where con_pendiente) as pedidos_con_pendientes
    from pedidos_unicos_dia group by fecha_actualizacion
  ),
  lineas_por_dia as (
    select fecha_actualizacion, count(*) as lineas_totales, count(*) filter (where con_pendiente) as lineas_pendientes
    from lineas_unicas_dia group by fecha_actualizacion
  ),
  valores_por_dia as (
    select fecha_actualizacion,
      coalesce(sum(cant_pedida), 0) as cantidad_total,
      coalesce(sum(cant_pendiente), 0) as cantidad_pendiente,
      coalesce(sum(valor_subtotal), 0) as valor_total,
      coalesce(sum(case when cant_pedida > 0 then (valor_subtotal / cant_pedida) * cant_pendiente else 0 end), 0) as valor_pendiente
    from base_final
    where fecha_actualizacion is not null
    group by fecha_actualizacion
  ),
  por_dia_calc as (
    select v.fecha_actualizacion as dia,
      p.pedidos_totales, p.pedidos_con_pendientes,
      l.lineas_totales, l.lineas_pendientes,
      v.cantidad_total, v.cantidad_pendiente, v.valor_total, v.valor_pendiente
    from valores_por_dia v
    join pedidos_por_dia p on p.fecha_actualizacion = v.fecha_actualizacion
    join lineas_por_dia l on l.fecha_actualizacion = v.fecha_actualizacion
  ),
  por_dia as (
    select dia,
      case when pedidos_totales = 0 then 0 else 1 - (pedidos_con_pendientes::numeric / pedidos_totales) end as ns_pedidos,
      case when lineas_totales = 0 then 0 else 1 - (lineas_pendientes::numeric / lineas_totales) end as ns_lineas,
      case when cantidad_total = 0 then 0 else 1 - (cantidad_pendiente / cantidad_total) end as ns_cantidad,
      case when valor_total = 0 then 0 else 1 - (valor_pendiente / valor_total) end as ns_valor
    from por_dia_calc
  )
  select jsonb_build_object(
    'tarjetas', (
      select to_jsonb(t) || jsonb_build_object(
        'ns_total', round(((t.ns_valor + t.ns_cantidad + t.ns_lineas) * 0.3) + (t.ns_pedidos * 0.1), 4)
      )
      from tarjetas t
    ),
    'por_proveedor', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'proveedor', proveedor, 'valor_solicitado', valor_solicitado, 'valor_facturado', valor_facturado,
        'ns_valor', case when valor_solicitado > 0 then valor_facturado / valor_solicitado else 0 end,
        'porcentaje_pendiente', case when valor_solicitado > 0 then 1 - (valor_facturado / valor_solicitado) else 0 end
      ) order by valor_solicitado desc), '[]'::jsonb)
      from por_proveedor
    ),
    'por_vendedor', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nombre_vendedor', nombre_vendedor, 'valor_solicitado', valor_solicitado, 'valor_facturado', valor_facturado,
        'ns_valor', case when valor_solicitado > 0 then valor_facturado / valor_solicitado else 0 end,
        'porcentaje_pendiente', case when valor_solicitado > 0 then 1 - (valor_facturado / valor_solicitado) else 0 end
      ) order by valor_solicitado desc), '[]'::jsonb)
      from por_vendedor
    ),
    'por_cliente', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'razon_social_cliente_despacho', razon_social_cliente_despacho, 'valor_solicitado', valor_solicitado, 'valor_facturado', valor_facturado,
        'ns_valor', case when valor_solicitado > 0 then valor_facturado / valor_solicitado else 0 end,
        'porcentaje_pendiente', case when valor_solicitado > 0 then 1 - (valor_facturado / valor_solicitado) else 0 end
      ) order by valor_solicitado desc), '[]'::jsonb)
      from por_cliente
    ),
    'por_responsable', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'responsable', responsable, 'valor', valor, 'cantidad_total', cantidad_total, 'valor_pendiente', valor_pendiente
      ) order by valor_pendiente desc), '[]'::jsonb)
      from por_responsable
    ),
    'por_motivo', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'motivo', motivo, 'valor', valor, 'cantidad_total', cantidad_total, 'valor_pendiente', valor_pendiente
      ) order by valor_pendiente desc), '[]'::jsonb)
      from por_motivo
    ),
    'por_item_pendiente', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'desc_item', desc_item, 'cantidad_pendiente', cantidad_pendiente, 'valor_pendiente', valor_pendiente
      ) order by valor_pendiente desc), '[]'::jsonb)
      from por_item
    ),
    'por_motivo_item', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'motivo', motivo, 'desc_item', desc_item, 'cantidad_pendiente', cantidad_pendiente, 'valor_pendiente', valor_pendiente
      ) order by valor_pendiente desc), '[]'::jsonb)
      from por_motivo_item
    ),
    'por_clasificacion_referencia', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'clasificacion', clasificacion,
        'cantidad_referencias', cantidad_referencias,
        'valor_solicitado', valor_solicitado,
        'valor_facturado', valor_facturado,
        'valor_pendiente', valor_pendiente,
        'ns_valor', case when valor_solicitado > 0 then valor_facturado / valor_solicitado else 0 end,
        'porcentaje_pendiente', case when valor_solicitado > 0 then 1 - (valor_facturado / valor_solicitado) else 0 end
      ) order by clasificacion), '[]'::jsonb)
      from por_clasificacion_referencia
    ),
    'curva_pareto', (
      select jsonb_build_object(
        'puntos', coalesce((select jsonb_agg(jsonb_build_object('pct_items', pct_items, 'pct_valor', pct_valor) order by pct_items) from curva_muestreada), '[]'::jsonb),
        'x_a', (select x_a from umbrales_pareto),
        'x_b', (select x_b from umbrales_pareto),
        'x_c', (select x_c from umbrales_pareto)
      )
    ),
    'grafico_co', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'co', co,
        'periodo_actual', case when valor_solicitado > 0 then round((valor_facturado / valor_solicitado) * 100, 1) else 0 end
      ) order by co), '[]'::jsonb)
      from por_co
    ),
    'grafico_dia', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dia', dia,
        'ns_total', round((((ns_valor + ns_cantidad + ns_lineas) * 0.3) + (ns_pedidos * 0.1)) * 100, 1)
      ) order by dia), '[]'::jsonb)
      from por_dia
    )
  );
$$;

grant execute on function dashboard_completo(date,date,text[],text,text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Índices (por si faltan tras las limpiezas anteriores).
-- ---------------------------------------------------------------------
create index if not exists idx_pedidos_co_fecha_actualizacion on pedidos(co, fecha_actualizacion);
-- Este índice es clave: el de arriba (co, fecha_actualizacion) solo sirve
-- cuando SÍ se filtra por C.O.; cuando un usuario ve "todos los C.O."
-- (lo más común), Postgres no puede usarlo para filtrar por fecha y
-- termina recorriendo la tabla completa. Con datos de varios meses esto
-- se nota mucho — este índice evita ese recorrido completo.
create index if not exists idx_pedidos_fecha_actualizacion_sola on pedidos(fecha_actualizacion);
create index if not exists idx_pedidos_co_cliente on pedidos(co, razon_social_cliente_despacho);
create index if not exists idx_pedidos_co_referencia2 on pedidos(co, referencia);
create index if not exists idx_pedidos_desc_item on pedidos(desc_item);

-- ---------------------------------------------------------------------
-- 8. Aumentar el tiempo máximo de espera de las consultas para este
--    proyecto. Si tu plan de Supabase no te deja ejecutar esto, no pasa
--    nada: hazlo manualmente desde Project Settings > Database.
-- ---------------------------------------------------------------------
do $$
begin
  execute 'alter role authenticator set statement_timeout = ''30s''';
exception when others then
  raise notice 'No se pudo ajustar el statement_timeout automáticamente (%). Hazlo desde Project Settings > Database si lo necesitas.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Aumentar la memoria disponible por consulta (work_mem). Con pocos
--    meses de datos no se notaba, pero con varios meses (cientos de
--    miles de filas), Postgres se queda sin memoria para ordenar y
--    agrupar, y termina usando el disco en su lugar — mucho más lento.
--    Con más memoria, esas operaciones se hacen en RAM.
-- ---------------------------------------------------------------------
do $$
begin
  execute 'alter role authenticator set work_mem = ''64MB''';
exception when others then
  raise notice 'No se pudo ajustar el work_mem automáticamente (%). Hazlo desde Project Settings > Database si lo necesitas.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Cierre de mes: elimina TODOS los pedidos para empezar el mes
--    siguiente con la base vacía (pensado para cuando no hay presupuesto
--    para un plan de Supabase con más cómputo/almacenamiento — así el
--    volumen de datos activo se queda siempre acotado a un mes).
--    Antes de llamar esta función desde la aplicación, se exige haber
--    descargado el detalle del mes; de todas formas, aquí queda
--    restringida a administradores como última barrera de seguridad.
-- ---------------------------------------------------------------------
create or replace function eliminar_todos_los_pedidos()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  if not es_administrador(auth.uid()) then
    raise exception 'Solo un administrador puede eliminar todos los pedidos.';
  end if;
  select count(*) into total from pedidos;
  -- Supabase bloquea por seguridad cualquier DELETE sin WHERE (extensión
  -- "safeupdate"); "where id is not null" borra todo igual, cumpliendo
  -- ese requisito.
  delete from pedidos where id is not null;
  return total;
end;
$$;

grant execute on function eliminar_todos_los_pedidos() to authenticated;

notify pgrst, 'reload schema';
