-- =====================================================================
-- COMPRAS APP - Esquema de base de datos (Supabase / PostgreSQL)
-- Etapa 1
-- =====================================================================
-- Cómo usarlo:
--   1. Crea un proyecto en https://supabase.com
--   2. Ve a SQL Editor y pega/ejecuta este archivo completo.
--   3. Copia la URL y las llaves (anon y service_role) al archivo .env.local
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERFILES DE USUARIO (extiende auth.users)
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  correo text not null,
  celular text,
  rol text not null default 'usuario' check (rol in ('administrador', 'comprador', 'usuario')),
  -- Lista de C.O. que puede ver. NULL o '{}' con ve_todos_co = true significa "todos".
  cos_permitidos text[] not null default '{}',
  ve_todos_co boolean not null default false,
  -- Módulos visibles: 'importar','configuracion_usuarios','configuracion_motivos','pendientes'
  modulos_permitidos text[] not null default '{}',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table profiles is 'Perfil extendido de cada usuario, referenciado a auth.users';

-- ---------------------------------------------------------------------
-- 2. MOTIVOS (y su responsable)
-- ---------------------------------------------------------------------
create table if not exists motivos (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  responsable text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. PEDIDOS (acumulativa, con validación de duplicados)
--    Clave de duplicado: C.O. + Nro documento + Bodega + Referencia
-- ---------------------------------------------------------------------
create table if not exists pedidos (
  id bigint generated always as identity primary key,
  co text not null,
  fecha date,
  fecha_actualizacion date,
  nro_documento text not null,
  bodega text not null,
  proveedor text,
  referencia text not null,
  desc_item text,
  cant_pedida numeric not null default 0,
  cant_remision numeric not null default 0,
  cant_pendiente numeric not null default 0,
  valor_subtotal numeric not null default 0,
  cliente_factura text,
  razon_social_cliente_despacho text,
  nombre_vendedor text,
  canal text,
  sucursal_despacho text,
  -- asignación de motivo (módulo Pendientes)
  motivo_id bigint references motivos(id),
  responsable_motivo text,
  motivo_asignado_en timestamptz,
  motivo_asignado_por uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint pedidos_unico unique (co, nro_documento, bodega, referencia)
);

create index if not exists idx_pedidos_co on pedidos(co);
create index if not exists idx_pedidos_pendiente on pedidos(cant_pendiente) where cant_pendiente > 0;
create index if not exists idx_pedidos_fecha on pedidos(fecha);

-- ---------------------------------------------------------------------
-- 4. VENTAS (acumulativa) / ENTRADAS (acumulativa)
--    NOTA: el documento original no especificó las columnas de estas
--    bases, así que se guardan en formato flexible (jsonb) más los
--    metadatos de carga. Cuando definas las columnas exactas, dímelo y
--    convertimos estas tablas a columnas tipadas igual que "pedidos".
-- ---------------------------------------------------------------------
create table if not exists ventas (
  id bigint generated always as identity primary key,
  data jsonb not null,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now()
);

create table if not exists entradas (
  id bigint generated always as identity primary key,
  data jsonb not null,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. INVENTARIO (reemplaza) / REFERENCIAS (reemplaza)
-- ---------------------------------------------------------------------
create table if not exists inventario (
  id bigint generated always as identity primary key,
  data jsonb not null,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now()
);

create table if not exists referencias (
  id bigint generated always as identity primary key,
  data jsonb not null,
  archivo_origen text,
  cargado_por uuid references profiles(id),
  cargado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. LOG DE IMPORTACIONES (para mostrar tiempo, cantidad y errores)
-- ---------------------------------------------------------------------
create table if not exists import_logs (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('pedidos','ventas','inventario','referencias','entradas')),
  archivo text,
  usuario_id uuid references profiles(id),
  registros_totales int not null default 0,
  registros_insertados int not null default 0,
  registros_omitidos int not null default 0,
  errores jsonb not null default '[]',
  duracion_ms int not null default 0,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- VISTAS DE CLASIFICACIÓN PARETO (mes actual)
-- =====================================================================

-- Nota: security_invoker = true asegura que las políticas RLS de "pedidos"
-- se evalúen con los permisos del usuario que consulta la vista, y no con
-- los del dueño de la vista (comportamiento por defecto de Postgres).
create or replace view v_pedidos_mes_actual
  with (security_invoker = true) as
  select * from pedidos
  where date_trunc('month', coalesce(fecha, fecha_actualizacion)) = date_trunc('month', current_date);

-- Pareto por Cliente: agrupa por C.O. & Razon social cliente & Valor subtotal
create or replace view v_pareto_cliente
  with (security_invoker = true) as
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

-- Pareto por Referencia: agrupa por C.O. & Referencia & Valor subtotal
create or replace view v_pareto_referencia
  with (security_invoker = true) as
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

-- Vista final de Pendientes con clasificaciones y datos de motivo
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
  left join v_pareto_cliente pc on pc.co = p.co and pc.cliente = p.razon_social_cliente_despacho
  left join v_pareto_referencia pr on pr.co = p.co and pr.referencia = p.referencia
  where p.cant_pendiente > 0;

-- =====================================================================
-- FUNCIÓN: tarjetas de indicadores (Pedidos, Líneas, Cantidad, Valor)
-- =====================================================================
create or replace function get_pedidos_cards(
  co_list text[] default null,       -- null = todos los C.O. permitidos
  fecha_inicio date default null,
  fecha_fin date default null,
  solo_sin_motivo boolean default false
)
returns table (
  pedidos_totales bigint,
  pedidos_con_pendientes bigint,
  ns_pedidos numeric,
  lineas_totales bigint,
  lineas_pendientes bigint,
  ns_lineas numeric,
  cantidad_total numeric,
  cantidad_pendiente numeric,
  ns_cantidad numeric,
  valor_total numeric,
  valor_pendiente numeric,
  ns_valor numeric
)
language sql
stable
as $$
  with filtrado as (
    select *
    from pedidos p
    where (co_list is null or p.co = any(co_list))
      and (fecha_inicio is null or p.fecha >= fecha_inicio)
      and (fecha_fin is null or p.fecha <= fecha_fin)
      and (not solo_sin_motivo or p.motivo_id is null)
  ),
  agg as (
    select
      count(distinct (co, nro_documento)) as pedidos_totales,
      count(distinct (co, nro_documento)) filter (where cant_pendiente > 0) as pedidos_con_pendientes,
      count(distinct (co, referencia, nro_documento)) as lineas_totales,
      count(distinct (co, referencia, nro_documento)) filter (where cant_pendiente > 0) as lineas_pendientes,
      coalesce(sum(cant_pedida), 0) as cantidad_total,
      coalesce(sum(cant_pendiente), 0) as cantidad_pendiente,
      coalesce(sum(valor_subtotal), 0) as valor_total,
      coalesce(sum(
        case when cant_pedida > 0
          then (valor_subtotal / cant_pedida) * cant_pendiente
          else 0
        end
      ), 0) as valor_pendiente
    from filtrado
  )
  select
    pedidos_totales,
    pedidos_con_pendientes,
    case when pedidos_totales = 0 then 0
      else round(1 - (pedidos_con_pendientes::numeric / pedidos_totales), 4) end as ns_pedidos,
    lineas_totales,
    lineas_pendientes,
    case when lineas_totales = 0 then 0
      else round(1 - (lineas_pendientes::numeric / lineas_totales), 4) end as ns_lineas,
    cantidad_total,
    cantidad_pendiente,
    case when cantidad_total = 0 then 0
      else round(1 - (cantidad_pendiente / cantidad_total), 4) end as ns_cantidad,
    valor_total,
    valor_pendiente,
    case when valor_total = 0 then 0
      else round(1 - (valor_pendiente / valor_total), 4) end as ns_valor
  from agg;
$$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table profiles enable row level security;
alter table motivos enable row level security;
alter table pedidos enable row level security;
alter table ventas enable row level security;
alter table inventario enable row level security;
alter table referencias enable row level security;
alter table entradas enable row level security;
alter table import_logs enable row level security;

-- profiles: cada quien ve su propio perfil; administradores ven todos
create policy "ver propio perfil o admin ve todos" on profiles
  for select using (
    auth.uid() = id
    or exists (select 1 from profiles p2 where p2.id = auth.uid() and p2.rol = 'administrador')
  );

create policy "solo admin inserta perfiles" on profiles
  for insert with check (
    exists (select 1 from profiles p2 where p2.id = auth.uid() and p2.rol = 'administrador')
  );

create policy "solo admin actualiza perfiles" on profiles
  for update using (
    exists (select 1 from profiles p2 where p2.id = auth.uid() and p2.rol = 'administrador')
  );

-- motivos: cualquier usuario autenticado puede leer; solo admin escribe
create policy "usuarios autenticados leen motivos" on motivos
  for select using (auth.role() = 'authenticated');

create policy "solo admin escribe motivos" on motivos
  for all using (
    exists (select 1 from profiles p2 where p2.id = auth.uid() and p2.rol = 'administrador')
  );

-- pedidos: visibles solo si el C.O. está permitido para el usuario (o ve_todos_co / admin)
create policy "pedidos visibles segun co del usuario" on pedidos
  for select using (
    exists (
      select 1 from profiles p2
      where p2.id = auth.uid()
        and (p2.rol = 'administrador' or p2.ve_todos_co = true or pedidos.co = any(p2.cos_permitidos))
    )
  );

create policy "usuarios autenticados insertan pedidos" on pedidos
  for insert with check (auth.role() = 'authenticated');

create policy "usuarios autenticados actualizan pedidos (motivo)" on pedidos
  for update using (auth.role() = 'authenticated');

-- ventas / inventario / referencias / entradas: lectura y escritura para autenticados
create policy "autenticados leen ventas" on ventas for select using (auth.role() = 'authenticated');
create policy "autenticados insertan ventas" on ventas for insert with check (auth.role() = 'authenticated');

create policy "autenticados leen inventario" on inventario for select using (auth.role() = 'authenticated');
create policy "autenticados escriben inventario" on inventario for all using (auth.role() = 'authenticated');

create policy "autenticados leen referencias" on referencias for select using (auth.role() = 'authenticated');
create policy "autenticados escriben referencias" on referencias for all using (auth.role() = 'authenticated');

create policy "autenticados leen entradas" on entradas for select using (auth.role() = 'authenticated');
create policy "autenticados insertan entradas" on entradas for insert with check (auth.role() = 'authenticated');

create policy "autenticados leen logs" on import_logs for select using (auth.role() = 'authenticated');
create policy "autenticados insertan logs" on import_logs for insert with check (auth.role() = 'authenticated');

-- =====================================================================
-- Primer usuario administrador
-- =====================================================================
-- Después de crear tu primer usuario desde Supabase Auth (Authentication
-- > Users > Add user), ejecuta esto reemplazando el UUID y los datos:
--
-- insert into profiles (id, nombre_completo, correo, rol, ve_todos_co, modulos_permitidos)
-- values (
--   'UUID-DEL-USUARIO-AQUI',
--   'Nombre Administrador',
--   'admin@empresa.com',
--   'administrador',
--   true,
--   array['importar','configuracion_usuarios','configuracion_motivos','pendientes']
-- );
