-- =====================================================================
-- CORRECCIÓN: C.O. sin ceros a la izquierda (por el archivo dañado)
-- Ejecuta este archivo completo en el SQL Editor de Supabase.
-- =====================================================================
-- Qué pasó: el archivo dañado que intentaste importar tenía la columna
-- C.O. guardada como NÚMERO en vez de TEXTO en algunas filas. Cuando eso
-- pasa, Excel le quita los ceros a la izquierda (ej. "001" se guarda
-- como el número 1). La aplicación leyó esas filas tal cual, así que
-- terminaste con C.O. duplicados: "001" por un lado y "1" por otro,
-- aunque son el mismo centro de operación.
--
-- Este script:
--   1. Revisa primero cuántas filas están afectadas (para que las veas
--      antes de corregir nada).
--   2. Donde una fila con C.O. sin ceros (ej. "1") ya existe también con
--      el C.O. correcto (ej. "001") — mismo Nro documento + Bodega +
--      Referencia — se trata como una importación duplicada: se borra
--      la copia mal formateada y se conserva la correcta.
--   3. El resto de filas con C.O. sin ceros (las que no chocan con
--      ninguna otra) simplemente se corrigen, agregándoles los ceros.
--   4. Se corrige también el catálogo de C.O. (Configuración > C.O.) y
--      los C.O. permitidos de cada usuario, por si quedaron con el
--      mismo problema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Paso 0 (solo para revisar, no cambia nada): cuántas filas están mal
-- ---------------------------------------------------------------------
select co, count(*) as cantidad_filas
from pedidos
where co ~ '^[0-9]+$' and length(co) < 3
group by co
order by co;

-- ---------------------------------------------------------------------
-- Paso 1: borrar los duplicados reales (la fila con C.O. sin ceros que
-- ya existía también con el C.O. correcto)
-- ---------------------------------------------------------------------
delete from pedidos p1
where p1.co ~ '^[0-9]+$' and length(p1.co) < 3
  and exists (
    select 1 from pedidos p2
    where p2.co = lpad(p1.co, 3, '0')
      and p2.nro_documento = p1.nro_documento
      and p2.bodega = p1.bodega
      and p2.referencia = p1.referencia
  );

-- ---------------------------------------------------------------------
-- Paso 2: corregir el resto (agregar los ceros que faltaban)
-- ---------------------------------------------------------------------
update pedidos
set co = lpad(co, 3, '0')
where co ~ '^[0-9]+$' and length(co) < 3;

-- ---------------------------------------------------------------------
-- Paso 3: corregir el catálogo de C.O. (Configuración > C.O.), si tiene
-- el mismo problema
-- ---------------------------------------------------------------------
delete from cos c1
where c1.codigo ~ '^[0-9]+$' and length(c1.codigo) < 3
  and exists (select 1 from cos c2 where c2.codigo = lpad(c1.codigo, 3, '0'));

update cos
set codigo = lpad(codigo, 3, '0')
where codigo ~ '^[0-9]+$' and length(codigo) < 3;

-- ---------------------------------------------------------------------
-- Paso 4: corregir los C.O. permitidos de cada usuario (Configuración >
-- Usuarios), por si a alguien le quedó asignado el código sin ceros
-- ---------------------------------------------------------------------
update profiles
set cos_permitidos = (
  select array_agg(distinct
    case when co ~ '^[0-9]+$' and length(co) < 3 then lpad(co, 3, '0') else co end
  )
  from unnest(cos_permitidos) as co
)
where cos_permitidos is not null and array_length(cos_permitidos, 1) > 0;

-- ---------------------------------------------------------------------
-- Paso 5 (para confirmar): ya no debería quedar ningún C.O. sin ceros
-- ---------------------------------------------------------------------
select distinct co from pedidos where co ~ '^[0-9]+$' and length(co) < 3;
select distinct codigo from cos where codigo ~ '^[0-9]+$' and length(codigo) < 3;
