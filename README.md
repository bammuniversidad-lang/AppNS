# Compras — Etapa 1

Aplicación web para gestión de pedidos y pendientes, construida con Next.js
y Supabase (Postgres + Auth).

## Qué incluye esta etapa

- **Login** con usuario y contraseña (Supabase Auth).
- **Importar bases de datos** (xlsx/csv):
  - Pedidos: acumulativa, valida duplicados por C.O. + Nro documento + Bodega + Referencia.
  - Ventas: acumulativa.
  - Inventario: reemplaza la data existente.
  - Referencia: reemplaza la data existente.
  - Entradas: acumulativa.
  - Cada carga muestra tiempo, cantidad de registros y errores por fila.
- **Configuración**:
  - Usuarios: nombre, correo, celular, rol, C.O. permitidos, módulos permitidos.
  - Motivos: nombre del motivo + responsable.
- **Pendientes**:
  - Filtrado por rango de fechas, "solo sin motivo" y C.O. según el usuario.
  - Tarjetas: Pedidos, Líneas, Cantidad, Valor (con "nivel de servicio").
  - Clasificación Pareto (A/B/C/D) por cliente y por referencia, calculada
    sobre el mes actual.
  - Asignación de motivo uno a uno o en bloque (selección múltiple).
  - Ocultar/mostrar columnas.
  - Exportar a Excel el rango filtrado, con motivos y responsables.

### Nota importante sobre Ventas / Inventario / Referencia / Entradas

El documento original no especificó las columnas exactas de estas 4 bases
(solo se indicó si son acumulativas o si reemplazan la data). Para no
bloquear el desarrollo, estas 4 tablas se crearon de forma flexible: cada
fila del archivo se guarda completa en una columna `data` (formato JSON),
sin perder ninguna columna que traiga el archivo.

Cuando me indiques las columnas exactas de Ventas, Inventario, Referencia
y Entradas (igual que hiciste con Pedidos), se pueden convertir a tablas
con columnas tipadas, iguales de robustas que "pedidos" — con sus propias
reglas de validación si las necesitan.

## 1. Crear el proyecto de Supabase

1. Ve a https://supabase.com y crea un proyecto nuevo (gratis para empezar).
2. Entra a **SQL Editor** y pega/ejecuta todo el contenido de `supabase/schema.sql`.
3. Ve a **Project Settings > API** y copia:
   - Project URL
   - `anon` `public` key
   - `service_role` key (secreta, nunca la compartas ni la subas a git)

## 2. Configurar el proyecto localmente

```bash
npm install
cp .env.local.example .env.local
# Edita .env.local y pega tus 3 valores de Supabase
```

## 3. Crear el primer usuario administrador

1. En Supabase, ve a **Authentication > Users > Add user** y crea tu usuario
   (correo + contraseña). Cópiate el UUID que se genera.
2. En **SQL Editor**, ejecuta (reemplazando los valores):

```sql
insert into profiles (id, nombre_completo, correo, rol, ve_todos_co, modulos_permitidos)
values (
  'UUID-DEL-USUARIO-AQUI',
  'Tu nombre',
  'tu-correo@empresa.com',
  'administrador',
  true,
  array['importar','configuracion_usuarios','configuracion_motivos','pendientes']
);
```

Con esto ya puedes entrar a la aplicación como administrador y crear el
resto de usuarios desde **Configuración > Usuarios** (esa pantalla crea el
usuario en Supabase Auth automáticamente, no hace falta repetir el paso
manual de arriba para los siguientes usuarios).

## 4. Correr en desarrollo

```bash
npm run dev
```

Abre http://localhost:3000 — te enviará a `/login`.

## 5. Desplegar (recomendado: Vercel)

1. Sube este proyecto a un repositorio de GitHub.
2. Entra a https://vercel.com, importa el repositorio.
3. En las variables de entorno de Vercel agrega las mismas 3 de `.env.local`
   (la `SUPABASE_SERVICE_ROLE_KEY` debe marcarse como variable de servidor,
   nunca se expone al navegador — este proyecto ya está armado así:
   solo se usa dentro de `pages/api/crear-usuario.js`).
4. Despliega. Cada vez que hagas push a la rama principal se actualizará solo.

## Estructura del proyecto

```
compras-app/
├── supabase/schema.sql        # Tablas, vistas Pareto, función de tarjetas, RLS
├── lib/                       # Cliente Supabase, contexto de auth, utilidades de import
├── components/Layout.js       # Menú lateral según módulos del usuario
├── pages/
│   ├── login.js
│   ├── index.js
│   ├── importar.js
│   ├── pendientes.js
│   ├── configuracion/usuarios.js
│   ├── configuracion/motivos.js
│   └── api/crear-usuario.js   # Crea usuarios en Supabase Auth (usa service_role)
└── styles/globals.css         # Arial 12px, tema claro/oscuro
```

## Siguientes etapas

Cuando quieras seguimos con la Etapa 2. Ideas pendientes de tu documento
original que quedaron abiertas para definir con más detalle:
- Columnas exactas de Ventas, Inventario, Referencia y Entradas.
- Reglas específicas de "Pendientes" más allá de lo ya construido (por
  ejemplo, si necesitas alertas, notificaciones, o reportes adicionales).

---

## Etapa 2 (agregada)

Para actualizar un proyecto que ya tenías corriendo con la Etapa 1:

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido de
   `supabase/etapa2_migration.sql` (después de tener ya `schema.sql` y el
   `fix_rls_profiles.sql` aplicados).
2. Reemplaza tus archivos locales por los de este paquete (o descomprime
   encima de tu carpeta `compras-app` existente).
3. Corre `npm install` de nuevo (se agregó la librería `recharts` para
   los gráficos del Dashboard).
4. `npm run dev` como siempre.

### Qué incluye la Etapa 2

- Menú rediseñado: barra superior con el nombre del usuario y el botón de
  fondo blanco/negro; Configuración ahora es un solo ítem desplegable
  (Usuarios, Motivos, C.O.); todas las opciones se resaltan al pasar el
  cursor o al estar activas.
- Usuarios: los campos celular y contraseña ya no traen nada
  predeterminado; se puede **editar** un usuario existente; el formulario
  de creación se oculta detrás de un botón "+ Crear usuario".
- Nueva opción **Configuración > C.O.**: crear centros de operación
  manualmente (sin depender de que ya existan en Pedidos).
- Motivos: cada línea tiene un botón "Modificar"; ya no se puede eliminar
  un motivo (para no romper el histórico de pedidos que lo usan).
- Importar: cuando hay líneas omitidas, se listan (motivo + datos) y se
  pueden descargar completas en Excel. Se agregó una quinta base:
  **Clientes** (reemplaza en cada carga), con las columnas exactas que
  diste (C.O. factura, Código, Estado, Razón social, Sucursal, etc.).
  Esta base se usa para cruzar Canal y Zona en el Dashboard, mediante la
  llave Código + Sucursal = Cliente factura + Sucursal despacho.
- Pendientes: tarjetas más grandes con degradado azul y efecto flotante;
  encabezados de tabla en gris metalizado y centrados; columnas
  redimensionables (arrastra el borde derecho del encabezado); ordenado
  por defecto por C.O. y Referencia; la tabla ya no desaparece mientras
  se actualiza (se muestra un aviso pequeño en su lugar, en vez de una
  pantalla en blanco).
- Nueva opción de menú **Dashboard**: nivel de servicio de abastecimiento,
  con los 6 cuadros (proveedor, vendedor, cliente, responsable, motivo,
  ítems con pendiente — todos ordenables al hacer clic en el encabezado),
  2 gráficos (NS Valor por C.O. comparado con el mismo mes del año
  anterior, y NS Valor por mes), filtros (C.O., fechas, razón social
  sucursal, vendedor, proveedor, descripción de ítem, canal, zona), y
  exportación a Excel (o CSV automáticamente si el resultado supera
  100.000 líneas).

### Aclaración sobre la fórmula de NS Valor del Dashboard

Confirmaste que la fórmula correcta es:
- `NS VALOR = VALOR FACTURADO / VALOR SOLICITADO`
- `% PENDIENTE = 1 - NS VALOR`

Así quedó implementado (el documento original tenía un "1-" de más en la
definición de NS VALOR que hacía que el % pendiente saliera invertido).

### Pendiente de definir contigo

- El filtro "Razón social sucursal despacho" del Dashboard se implementó
  usando el campo `razon_social_sucursal` que viene de la nueva base de
  Clientes (cruzado por Código + Sucursal). Si te refieres a otro campo,
  dime cuál y lo ajusto.
- El Cuadro 4 (por responsable) usa el responsable que quedó asignado en
  Pendientes al elegir un motivo. Si un pedido nunca tuvo motivo asignado,
  aparece agrupado como "(sin asignar)".

---

## Etapa 3 (agregada) — mejoras de diseño

No requiere ninguna migración de base de datos nueva; solo reemplaza tus
archivos locales por los de este paquete y corre `npm install` de nuevo
(por si acaso) y `npm run dev`.

### Qué incluye

- **Login rediseñado**: tarjeta grande centrada, con ícono, subtítulo,
  mostrar/ocultar contraseña, "Recordarme", enlace de "¿Olvidaste tu
  contraseña?" (envía un correo real de recuperación vía Supabase), y
  fondo decorativo con círculos degradados. El nombre "APLICACIÓN
  ABASTECIMIENTO" aparece grande, fuera de la tarjeta.
- **Franja superior**: ya no dice "Compras", dice "APLICACIÓN
  ABASTECIMIENTO". El saludo cambia solo según la hora del día ("Buenos
  días/tardes/noches, Nombre (rol)"), y el círculo con la inicial del
  usuario despliega un menú con "Cerrar sesión" al hacer clic.
- **Dashboard**: se corrigió el error que impedía que cargara — cada
  cuadro y cada gráfico ahora está protegido individualmente, así que si
  algo puntual falla (por ejemplo, por falta de datos), el resto del
  Dashboard se sigue viendo con normalidad en vez de una pantalla en
  blanco. También se añadieron las 4 tarjetas del módulo Pendientes en la
  parte superior, y todos los cuadros y gráficos quedaron organizados en
  paneles con sombra, al estilo Power BI.
  
  Si después de esta actualización el Dashboard sigue sin mostrar
  información, ahora vas a ver el mensaje de error real en pantalla (en
  vez de una pantalla en blanco) — cópiamelo y lo resolvemos puntualmente.
- **Pendientes**: las tarjetas ahora tienen una barra debajo de cada
  indicador de nivel de servicio, que cambia de color y de tamaño según
  el porcentaje: verde si es mayor a 96%, amarillo entre 90% y 96%, rojo
  por debajo de 90%. El fondo azul degradado de la tarjeta se conservó.
- **Importar bases de datos**: cada base ahora es una línea independiente,
  con su propio selector de archivo y su propio botón "Importar" — ya no
  hay que cambiar de un menú desplegable.

### Nota sobre un posible error de Dashboard que persista

Si el Dashboard te sigue mostrando algo raro después de esta actualización,
lo más probable es que falte ejecutar `supabase/etapa2_migration.sql`
(que crea la vista `v_pedidos_dashboard` que usa esta página) — revisa que
la hayas corrido completa en el SQL Editor de Supabase.

---

## Etapa 4 (agregada) — rendimiento

Esta actualización corrige dos problemas de lentitud reales:

1. **La importación de Pedidos se colgaba (más de 1 hora, error 409).**
   La causa: para revisar si una línea ya existía, la app traía todas las
   llaves ya guardadas y las comparaba una por una — pero Supabase solo
   entrega 1.000 filas por consulta, así que si ya tenías más de 1.000
   pedidos de un mismo C.O., la app no se enteraba de la mayoría y
   terminaba intentando subir cosas que ya existían. Cada una de esas
   fallaba, y como se reintentaban de una en una, se volvía eterno.
   Ahora es la propia base de datos la que descarta los duplicados en el
   mismo lote de 500, en una sola llamada — sin necesidad de comparar
   nada desde la aplicación.

2. **Pendientes y el Dashboard se demoraban mucho (o daban "statement
   timeout").** La clasificación Pareto (A/B/C/D) se recalculaba por
   completo cada vez que alguien abría cualquiera de las dos páginas.
   Ahora se calcula una sola vez y se guarda (vista "materializada"); se
   actualiza sola después de cada importación de Pedidos, y también hay
   un botón **"Actualizar clasificación"** en Pendientes y en el
   Dashboard para forzar el recálculo cuando quieras.

3. Se puso la franja superior en gris metalizado.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido de
   `supabase/etapa4_migracion_rendimiento.sql`. Este archivo reemplaza
   las vistas de Pedidos/Pendientes/Dashboard, así que puede tardar
   varios segundos en correr — es normal.
   - Si te marca error en el último paso (`alter role authenticator...`),
     no pasa nada: esa línea solo aumenta el tiempo máximo de espera de
     las consultas, y puedes hacerlo manualmente desde **Project
     Settings > Database** en el panel de Supabase si tu plan no te deja
     ejecutarlo por SQL.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev` como siempre (no se agregaron librerías nuevas).

### Sobre el archivo NS_.xlsx que adjuntaste

Lo revisé: tiene 60.576 líneas de datos reales más una fila de "Gran
total" al inicio (típica de un reporte exportado con subtotales). Esa
fila de "Gran total" la aplicación ya la descarta sola (no tiene Nro
documento/Bodega/Referencia, así que cae en "omitidos" con el motivo
correspondiente) — no necesitas quitarla tú mismo antes de importar.
También encontré 43 líneas que vienen duplicadas dentro del propio
archivo (86 filas en total); con el arreglo de esta etapa, esas también
se resuelven solas: se sube una sola copia de cada una.



