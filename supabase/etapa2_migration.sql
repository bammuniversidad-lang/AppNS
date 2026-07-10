-- =====================================================================
-- COMPRAS APP - Migración Etapa 2
-- Ejecuta este archivo completo en el SQL Editor de Supabase
-- (además de haber ejecutado ya schema.sql y fix_rls_profiles.sql)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLA DE C.O. (Centros de Operación) — creación manual desde Configuración
-- ---------------------------------------------------------------------
create table if not exists cos (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  nombre text,
  created_at timestamptz not null default now()
);

alter table cos enable row level security;

create policy "autenticados leen cos" on cos
  for select using (auth.role() = 'authenticated');

create policy "solo admin escribe cos" on cos
  for all using (public.es_administrador(auth.uid()));

-- ---------------------------------------------------------------------
-- 2. TABLA DE CLIENTES (reemplaza en cada carga)
--    Llave de cruce con pedidos: clientes.codigo & clientes.sucursal
--    = pedidos.cliente_factura & pedidos.sucursal_despacho
-- ---------------------------------------------------------------------
create table if not exists clientes (
  id bigint generated always as identity primary key,
  co_factura text,
  codigo text,
  estado text,
  razon_social text,
  sucursal text,
  razon_social_sucursal text,
  nombre_establecimiento text,
  direccion_1 text,
  direccion_2 text,
  depto_estado text,
  ciudad text,
  desc_barrio text,
  canal text,
  centro_comercial text,
  zona text,
  bogota text,
  un_movto_factura text,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now()
);

create index if not exists idx_clientes_codigo_sucursal on clientes(codigo, sucursal);

alter table clientes enable row level security;

create policy "autenticados leen clientes" on clientes
  for select using (auth.role() = 'authenticated');

create policy "autenticados escriben clientes" on clientes
  for all using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- 3. Vista única para el Dashboard: pedidos + motivo + clasificación
--    Pareto + canal/zona del cliente. Se usa tanto para los cuadros y
--    gráficos como para la exportación.
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
    pc.clasificacion_cliente,
    pr.clasificacion_referencia,
    c.canal as cliente_canal,
    c.zona as cliente_zona,
    c.razon_social_sucursal
  from pedidos p
  left join motivos m on m.id = p.motivo_id
  left join v_pareto_cliente pc on pc.co = p.co and pc.cliente = p.razon_social_cliente_despacho
  left join v_pareto_referencia pr on pr.co = p.co and pr.referencia = p.referencia
  left join clientes c
    on c.codigo = p.cliente_factura
   and c.sucursal = p.sucursal_despacho;


-- ---------------------------------------------------------------------
-- 5. import_logs: permitir tipo 'clientes'
-- ---------------------------------------------------------------------
alter table import_logs drop constraint if exists import_logs_tipo_check;
alter table import_logs add constraint import_logs_tipo_check
  check (tipo in ('pedidos','ventas','inventario','referencias','entradas','clientes'));

-- ---------------------------------------------------------------------
-- 6. import_logs: guardar el detalle de líneas omitidas (para exportar)
-- ---------------------------------------------------------------------
alter table import_logs add column if not exists omitidos_detalle jsonb not null default '[]';
