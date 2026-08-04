-- =====================================================================
-- FIX: recursión infinita en las políticas de "profiles"
-- =====================================================================
-- El problema: la política de "profiles" consultaba la propia tabla
-- "profiles" para saber si el usuario es administrador, y esa consulta
-- volvía a activar la misma política -> recursión infinita.
--
-- La solución: una función "security definer" que consulta profiles
-- SIN pasar de nuevo por las políticas RLS (evita el ciclo).
-- =====================================================================

create or replace function public.es_administrador(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = uid and rol = 'administrador'
  );
$$;

-- Reemplazar las políticas de "profiles" para que usen la función
-- en vez de consultar la tabla directamente.

drop policy if exists "ver propio perfil o admin ve todos" on profiles;
create policy "ver propio perfil o admin ve todos" on profiles
  for select using (
    auth.uid() = id
    or public.es_administrador(auth.uid())
  );

drop policy if exists "solo admin inserta perfiles" on profiles;
create policy "solo admin inserta perfiles" on profiles
  for insert with check (
    public.es_administrador(auth.uid())
  );

drop policy if exists "solo admin actualiza perfiles" on profiles;
create policy "solo admin actualiza perfiles" on profiles
  for update using (
    public.es_administrador(auth.uid())
  );

-- También actualizamos las políticas de motivos y pedidos que consultaban
-- profiles directamente, para que usen la misma función (más rápido y
-- evita cualquier problema similar).

drop policy if exists "solo admin escribe motivos" on motivos;
create policy "solo admin escribe motivos" on motivos
  for all using (
    public.es_administrador(auth.uid())
  );

drop policy if exists "pedidos visibles segun co del usuario" on pedidos;
create policy "pedidos visibles segun co del usuario" on pedidos
  for select using (
    public.es_administrador(auth.uid())
    or exists (
      select 1 from profiles p2
      where p2.id = auth.uid()
        and (p2.ve_todos_co = true or pedidos.co = any(p2.cos_permitidos))
    )
  );
