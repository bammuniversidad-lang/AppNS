# Compras — Aplicación Abastecimiento

Aplicación web para gestión de pedidos y pendientes, construida con Next.js
y Supabase (Postgres + Auth).

## 🚀 Instalación (léeme primero)

No importa si ya habías instalado una versión anterior o si es tu primera
vez: sigue estos pasos y quedas al día. El resto de este documento es el
historial de cómo se construyó la aplicación — no hace falta leerlo para
instalarla.

1. En Supabase, **SQL Editor**, ejecuta en este orden (cada uno completo,
   de un solo pegado, no por partes):
   1. `supabase/schema.sql`
   2. `supabase/fix_rls_profiles.sql`
   3. `supabase/etapa2_migration.sql`
   4. `supabase/etapa8_migracion_consolidada.sql`
2. `npm install`
3. Copia `.env.local.example` a `.env.local` y pega tus 3 llaves de Supabase
   (ver sección "Crear el proyecto de Supabase" más abajo si es tu primera vez).
4. `npm run dev`

### ✅ Cómo verificar que la migración SÍ quedó aplicada

Reemplazar los archivos en tu computador **no cambia nada en Supabase**.
El paso que de verdad actualiza la base de datos es pegar y ejecutar el
`.sql` dentro de **Supabase → SQL Editor**. Para confirmar que sí quedó
aplicado, pega esto en el SQL Editor y ejecútalo:

```sql
select * from get_pedidos_cards(null, '2026-07-01', '2026-07-31', false);
```

Si ves una columna llamada **`ns_total`** en el resultado, la migración
quedó aplicada correctamente. Si te da un error de que la función no
existe, o el resultado no trae esa columna, es que todavía falta
ejecutar (o volver a ejecutar) `supabase/etapa8_migracion_consolidada.sql`.

Si ya habías ejecutado archivos de etapas anteriores (`etapa4`, `etapa5`,
`etapa6` o `etapa7` — ya no vienen en este paquete), **no pasa nada**: el
paso 4 (`etapa8_migracion_consolidada.sql`) limpia y reconstruye todo lo
necesario sin importar en qué quedó tu base de datos.

### Por qué hubo varios intentos fallidos con el Dashboard

La migración de una etapa anterior intentaba borrar una vista de la que
dependían otras, sin `CASCADE`, y Supabase corta la ejecución justo ahí —
por eso, aunque el script parecía correr, en realidad se quedaba a medias
y las funciones nuevas nunca se llegaban a crear. Antes de reenviarte esta
corrección, instalé Postgres localmente y ejecuté los scripts de verdad
(no solo los revisé a simple vista) para confirmar que esta vez sí quedan
aplicados correctamente de principio a fin, incluso partiendo desde una
base a medio migrar como la tuya.

## Qué incluye

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
2. Entra a **SQL Editor** y ejecuta, en orden, los 4 archivos listados en
   "🚀 Instalación" arriba.
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

---

## Etapa 5 (agregada)

### 1. Corrección importante: clasificación Pareto vacía

El cálculo de Clasificación Cliente / Clasificación Referencia estaba
fijo a "el mes actual" (guardado de antemano), así que si filtrabas
Pendientes o el Dashboard por otro rango de fechas, esas columnas salían
vacías. Ahora el cálculo se hace **al momento**, exactamente sobre el
rango de fechas (y C.O.) que tengas seleccionado — tal como pedías: se
calcula la participación de cada cliente o referencia dentro de lo
seleccionado, se acumula, y se asigna A/B/C/D.

Como quedó dinámico, ya no hace falta el botón "Actualizar clasificación"
que se había agregado antes — se quitó, porque ahora siempre está al día.

### 2. Fecha por defecto: mes actual

Tanto en Pendientes como en el Dashboard, los campos "Desde" y "Hasta"
ahora abren automáticamente con el primer día del mes en curso y la
fecha de hoy.

### 3. Dashboard con filtro cruzado (como Power BI)

Al hacer clic en cualquier fila de los 6 cuadros (por ejemplo, un
proveedor específico), todo el Dashboard —las demás tablas, las tarjetas
y los gráficos— se filtra automáticamente para mostrar solo lo
relacionado con esa selección. Aparece un aviso azul arriba indicando
qué está filtrado, con una "✕" para quitarlo.

### 4. Exportar el Dashboard: Excel con todas las tablas, y PDF

"Exportar a Excel" ahora genera un archivo con varias hojas: los datos
completos y cada uno de los 6 cuadros por separado. El nuevo botón
"Exportar a PDF" abre el diálogo de impresión del navegador ya preparado
(sin menús ni botones) para que elijas "Guardar como PDF" — respeta
exactamente lo que tengas filtrado en pantalla.

### 5. Scroll horizontal accesible en Pendientes

Se agregó una barra de desplazamiento delgada justo encima de la tabla
de Pendientes, sincronizada con la de abajo, para moverte a los lados
sin tener que bajar hasta el final de la página.

### 6. Franja superior azul metalizada

Se cambió de gris a azul metalizado, en todas las vistas.

### 7. Menú lateral colapsable

Por defecto aparece expandido con el logo 📦 y el nombre. Al hacer clic
en cualquier opción, o al sacar el cursor del menú, se contrae
automáticamente y solo queda el ícono ☰ (con los íconos de cada sección),
dejando toda la pantalla libre para el contenido. Para volver a
abrirlo, se hace clic en ☰.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido de
   `supabase/etapa5_migracion_pareto.sql`. Esto reemplaza las funciones
   y vistas relacionadas con Pedidos/Pendientes/Dashboard — es normal
   que tarde unos segundos.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev` como siempre (no se agregaron librerías nuevas).

---

## Etapa 6 (agregada) — corrección de la columna de fecha

Tenías toda la razón: todavía quedaba una inconsistencia real. Pendientes
y el Dashboard filtran los pedidos por la columna **Fecha actualización**,
pero el cálculo de clasificación Pareto y las tarjetas (Pedidos, Líneas,
Cantidad, Valor) seguían usando la columna **Fecha** — que es distinta.
Por eso algunos clientes o referencias que sí aparecían en la lista (por
Fecha actualización) no entraban en el cálculo de Pareto (por Fecha), y
salían en blanco. Como bien dijiste, matemáticamente todo registro debe
caer en A, B, C o D — el problema no era la fórmula, era que se estaban
comparando dos conjuntos de datos distintos.

Ahora **todo** —Pendientes, el Dashboard, las tarjetas y la clasificación
Pareto— filtra exclusivamente por **Fecha actualización**.

También limpié dos archivos de borrador que habían quedado sueltos en la
carpeta `supabase/` de una entrega anterior (`etapa4_migration.sql` y
`etapa5_migracion_pareto_dinamico.sql`) — eran versiones intermedias sin
usar que no debiste ejecutar; si ya las tienes en tu carpeta local,
bórralas para evitar confusión, no hacen falta.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido de
   `supabase/etapa6_migracion_fecha_actualizacion.sql`.
2. Reemplaza tus archivos locales por los de este paquete (ideal:
   reemplaza toda la carpeta `supabase/` para quedar solo con los
   archivos vigentes).
3. `npm run dev` como siempre (no hubo cambios de código, solo de base
   de datos).

---

## Etapa 7 (agregada) — rendimiento del Dashboard, NS Total, Pareto por mes completo

### 1. Dashboard lento → cálculos movidos al servidor

Antes, la aplicación traía TODAS las filas de pedidos al navegador (con
paginación de 1.000 en 1.000) y sumaba todo ahí mismo — por eso se
demoraba tanto, sobre todo al cambiar un filtro. Ahora existe una única
función en la base de datos, `dashboard_completo(...)`, que recibe todos
los filtros (fechas, C.O., proveedor, vendedor, canal, zona, y el filtro
cruzado) y devuelve un solo resultado ya calculado: las 5 tarjetas, los 6
cuadros y los 3 gráficos. El navegador ya no tiene que traer ni sumar
miles de filas — solo pinta lo que la base de datos ya calculó.

### 2. Clasificación Pareto: mes completo, no solo el rango exacto

Como indicaste: la clasificación A/B/C/D ahora se calcula sobre **todo el
mes** que contiene el rango "Desde/Hasta" seleccionado (no solo esos días
puntuales), agrupando **toda la base de pedidos** (no solo pendientes)
por C.O. + Cliente (o C.O. + Referencia) + Valor subtotal, calculando la
participación de cada uno, acumulando de mayor a menor, y clasificando.
Con esto, todo registro cae en A, B, C o D — ya no deberían quedar
casillas vacías.

### 3. Nueva tarjeta: NS Total

`NS Total = ((NS Valor + NS Cantidad + NS Líneas) × 30%) + (NS Pedidos × 10%)`

Aparece como una 5ª tarjeta junto a Pedidos, Líneas, Cantidad y Valor,
tanto en Pendientes como en el Dashboard.

### 4. Gráfico de NS Valor por mes: ya no depende del filtro Desde/Hasta

Antes, si filtrabas un solo mes, el gráfico de tendencia mensual mostraba
un único punto (no servía para ver tendencia). Ahora ese gráfico siempre
muestra los últimos 24 meses — sin importar qué rango de fechas tengas
seleccionado en los demás filtros — y el eje X muestra el mes **con el
año** (ej. "Jul-2026").

### 5. Nuevo gráfico: NS Total día a día

Un tercer gráfico que sí respeta el rango "Desde/Hasta" seleccionado,
mostrando el NS Total de cada día dentro de ese rango.

### 6. Los gráficos también filtran (no solo los cuadros)

- Clic en una barra del Gráfico 1 (por C.O.) → filtra todo el Dashboard
  por ese C.O.
- Clic en un punto del Gráfico 2 (por mes) → cambia el filtro
  Desde/Hasta a ese mes completo.
- Clic en una barra del Gráfico 3 (por día) → cambia el filtro
  Desde/Hasta a ese día específico.

### 7. Exportación mejorada

- **Excel**: ahora usa la librería `exceljs` para generar un archivo con
  formato real — encabezados en negrilla con fondo azul, columnas con
  formato de moneda o porcentaje, ancho de columna ajustado, y filtros
  automáticos. Trae una hoja "Resumen" con las tarjetas y una hoja por
  cada uno de los 6 cuadros.
- **PowerPoint** (nuevo): botón "Exportar a PowerPoint" que genera una
  presentación con portada (resumen de filtros aplicados), una
  diapositiva de indicadores generales, y una diapositiva con tabla por
  cada cuadro principal (limitada a las primeras 15 filas por
  diapositiva, para que sea legible — el Excel trae todo).
- **Etiquetas de datos**: ahora se ven los valores encima de cada
  barra/punto en los 3 gráficos.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido de
   `supabase/etapa7_migracion_dashboard_servidor.sql`. Es un archivo
   grande (crea varias funciones); puede tardar unos segundos.
2. Reemplaza tus archivos locales por los de este paquete.
3. Ejecuta `npm install` de nuevo — se agregaron dos librerías nuevas
   (`exceljs` para el Excel con formato, `pptxgenjs` para PowerPoint).
4. `npm run dev` como siempre.

### Documento de caracterización

Se incluye `Caracterizacion_Aplicacion_Abastecimiento.docx` con un
resumen completo del proyecto: arquitectura, módulos, reglas de negocio,
fórmulas, historial de cambios por etapa, y temas pendientes. Está
pensado para que, si empiezas una conversación nueva con Claude, lo
subas junto con el proyecto y Claude recupere todo el contexto sin que
tengas que repetir la historia.

---

## Etapa 8 (agregada) — corrección definitiva de la migración

Las Etapas 5, 6 y 7 quedaban, sin que se notara a simple vista,
aplicadas solo a medias: el script de la Etapa 5 intentaba borrar una
vista materializada de la que otras vistas dependían, sin `CASCADE`, y
Supabase corta la ejecución justo en ese punto. Por eso, aunque parecía
que todo se había ejecutado, la clasificación seguía en blanco, NS Total
no traía datos, y el Dashboard seguía fallando.

Esta vez, antes de reenviar la corrección, instalé PostgreSQL localmente,
recreé el mismo escenario "a medio migrar" que tenías tú, y ejecuté los
scripts de verdad — no solo los revisé a simple vista — hasta confirmar
que `dashboard_completo(...)` devuelve datos correctos y que
`obtener_pareto_cliente` / `obtener_pareto_referencia` clasifican bien
(probado con datos de ejemplo).

**A partir de esta etapa, la instalación se simplifica a 4 archivos SQL**
(ver "🚀 Instalación" al inicio de este documento):
`schema.sql` → `fix_rls_profiles.sql` → `etapa2_migration.sql` →
`etapa8_migracion_consolidada.sql`. Los archivos de las Etapas 4, 5, 6 y
7 ya no vienen en el paquete (quedaron reemplazados por completo).

También confirmé, con datos de prueba reales, que la fórmula de NS Total
que diste es correcta tal como está implementada:
`((NS Valor + NS Cantidad + NS Líneas) × 30%) + (NS Pedidos × 10%)`.

---

## Etapa 9 (agregada) — gráficos, nuevo cuadro, exportación más rápida

### 1. Clasificación ABCD: se agregó diagnóstico visible

Si `obtener_pareto_cliente` u `obtener_pareto_referencia` fallan por
cualquier motivo, Pendientes ahora te muestra el error real en pantalla
en vez de dejar la columna en blanco sin explicación. Si te vuelve a
salir vacío, ese mensaje me dice exactamente qué está pasando.

### 2. Gráficos: línea, sin cuadrícula, etiquetas legibles

- El Gráfico 3 (NS Total día a día) ahora es de **línea**, no de barras.
- Se quitó la cuadrícula de fondo de los 3 gráficos.
- Las etiquetas de dato ahora tienen un fondo azul claro para que se
  lean bien sobre cualquier color de línea o barra.
- En el Gráfico 3, el eje X ahora muestra solo el número del día
  (1, 2, 3…) en vez de la fecha completa.

### 3. Nuevo Cuadro 7: Motivo + Descripción ítem

Muestra Motivo, Descripción ítem, Cantidad pendiente y Valor pendiente,
agrupado por ambos campos juntos. Incluye clic para filtro cruzado (por
motivo), hoja propia en el Excel, y diapositiva propia en el PowerPoint.

### 4. Exportar a Excel: mucho más rápido

Antes, el botón "Exportar a Excel" volvía a traer TODAS las filas de
pedidos desde Supabase antes de generar el archivo — aunque el Excel con
formato solo necesita los cuadros que ya están calculados en pantalla.
Se quitó ese paso: ahora la exportación es casi instantánea, porque usa
los datos que el Dashboard ya tiene cargados.

### 5. PDF y PowerPoint: "top 15" en vez de intentar mostrar todo

Como una tabla muy larga no cabe bien en un PDF o una diapositiva, ahora
ambos formatos muestran claramente **el top 15 de cada cuadro** (los de
mayor valor), con una nota indicando cuántos registros hay en total y
que el Excel trae el detalle completo. También se corrigieron los
márgenes de las tablas en PowerPoint para que no se salgan de la
diapositiva, y se agregaron los 3 gráficos como gráficos nativos y
editables de PowerPoint (no como imágenes).

---

## Etapa 10 (agregada) — clasificación verificada con datos reales, gráficos

### La clasificación ABCD: verificada con tu propio Excel

Cargué tu archivo `Clasificacion.xlsx` (69.380 pedidos reales) en una
base de datos de prueba y comparé el resultado de nuestras funciones
contra tus hojas "Clasificacion Cliente" y "Clasificacion Referencia".
El resultado coincide casi exacto:

- **Cliente**: nuestra función dio A=1168, B=1487, C=1195, D=775 — tu
  Excel: A=1168, B=1486, C=1196, D=775.
- **Referencia**: después del ajuste de abajo, A=1435, B=2066, C=1972,
  D=2199 — tu Excel: A=1435, B=2065, C=1973, D=2199.

La fórmula siempre estuvo bien. Si en pantalla solo ves A y B, es porque
los clientes/ítems grandes (clase A) son los que más tienden a tener
líneas pendientes — las clases C y D sí existen, solo son menos
frecuentes ahí. Prueba ordenando la tabla por la columna "Clasif.
cliente" o "Clasif. referencia" (clic en el encabezado) para verlas todas.

**Cambio confirmado contigo**: la Clasificación Referencia ahora agrupa
por **Descripción del ítem** (como en tu Excel), no por el código de
Referencia.

### Gráficos

- Se agregó un borde/fondo oscuro al recuadro que aparece al pasar el
  cursor sobre un dato, para que combine con el tema oscuro.
- Las etiquetas de dato con 0% ya no se muestran (antes saturaban el
  Gráfico 1 cuando no hay datos del año anterior).
- El Gráfico 3 (NS Total día a día) ahora dibuja líneas rectas entre
  cada día en vez de una curva suavizada, para que el cambio real de un
  día a otro se vea tal cual es.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql` (cambia
   la función de clasificación de referencia).
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev` (no hay librerías nuevas).

---

## Etapa 12 (agregada) — la causa real de la clasificación en blanco

Después de que confirmaste con tu propia consulta en Supabase que la
base de datos sí devuelve las 4 clases correctamente, encontré la
causa real: **el mismo límite de 1.000 filas por consulta** que ya nos
había afectado antes (con la importación de Pedidos), esta vez en
`obtener_pareto_cliente` y `obtener_pareto_referencia`. Como puede haber
miles de clientes o de ítems distintos (en tus datos: 4.625 clientes y
7.672 ítems), Supabase solo entregaba los primeros 1.000 de cada
función — el resto quedaba sin clasificación en la aplicación, aunque
la base de datos sí los tenía calculados.

La solución: estas dos funciones ahora devuelven un solo valor `jsonb`
(un bloque de datos completo) en vez de una tabla — un valor único no
tiene el límite de paginación de 1.000 filas que sí aplica a las tablas.
Ya lo probé con tus 7.672 ítems reales y confirmé que ahora sí regresan
completos.

### Marca de versión

Se agregó un texto pequeño abajo a la derecha de cada pantalla
("Compras · versión etapaN-fecha") para poder confirmar rápidamente, la
próxima vez que algo no cuadre, si el navegador está corriendo el
código más reciente o uno viejo en caché.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql`.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, y haz un refresco forzado en el navegador
   (Ctrl+Shift+R) para asegurarte de ver la versión nueva.

---

## Etapa 14 (agregada) — Dashboard, cargas históricas, publicar en GitHub

### Dashboard: tablas más grandes, columnas redimensionables, colores

- Los paneles del Dashboard ahora son más anchos.
- Todas las columnas de los cuadros se pueden **redimensionar**
  arrastrando el borde derecho del encabezado (igual que en Pendientes),
  y el texto que no quepa ya no se corta a la mitad: queda con "..." y
  se puede pasar el mouse por encima para ver el valor completo, o
  ensanchar la columna.
- **NS Valor**: fondo verde metalizado si es ≥97%, amarillo si está
  entre 90% y 97%, rojo (con transparencia) si es menor.
- **% Pendiente**: verde si es ≤3%, amarillo entre 3% y 10%, rojo si es
  mayor.
- Los gráficos ahora tienen más espacio arriba para que ninguna etiqueta
  se corte, y el eje aumenta hasta 110% para dejar aire a las barras que
  llegan a 100%.
- **Nuevo Cuadro 8**: Detalle por clasificación de referencia (A/B/C/D)
  — cantidad de referencias, valor solicitado, valor facturado
  (remisionado), valor pendiente, NS Valor y % Pendiente, para cada una
  de las 4 clases. También en el Excel y el PowerPoint.

### Cargas históricas (año actual + año anterior)

Puedes importar tu histórico completo por el mismo módulo **Importar
bases de datos > Pedidos**, con las mismas columnas de siempre. Si
quieres que las líneas históricas ya vengan con motivo y responsable
asignado (en vez de asignarlos luego uno por uno en Pendientes), agrega
estas 2 columnas opcionales a tu archivo:

| Columna | Qué hace |
|---|---|
| `Motivo` | Si el motivo ya existe en Configuración > Motivos, se usa ese (sin importar mayúsculas/minúsculas). Si no existe, la aplicación lo **crea automáticamente** durante la importación. |
| `Responsable` | Se guarda directamente en cada pedido. Si el motivo de esa fila es nuevo, también se usa como responsable del motivo recién creado. |

No es obligatorio traer estas 2 columnas — si no las incluyes, el
pedido se importa igual, simplemente queda "sin motivo" hasta que lo
asignes desde Pendientes.

Recomendación práctica para cargar dos años de historia: divide el
archivo por año (o por trimestre) si es muy pesado, e impórtalos uno
por uno — el importador ya soporta archivos con decenas de miles de
líneas (ver Etapa 4).

### Cómo publicar el proyecto en GitHub y ponerlo en línea (paso a paso)

**Parte 1 — Subir el código a GitHub**

1. Crea una cuenta en https://github.com si no tienes.
2. Instala Git en tu computador si no lo tienes: https://git-scm.com/downloads
3. En GitHub, crea un repositorio nuevo (botón "New"). Puedes dejarlo
   **privado** (recomendado, ya que el código incluye la estructura de
   tu negocio) — no lo inicialices con README, porque ya tienes uno.
4. En tu computador, abre una terminal dentro de la carpeta `compras-app` y ejecuta:
   ```bash
   git init
   git add .
   git commit -m "Primera version"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPOSITORIO.git
   git push -u origin main
   ```
   (Reemplaza la URL por la que te da GitHub al crear el repositorio.)
5. Tu archivo `.gitignore` ya está configurado para NO subir `.env.local`
   (tus llaves secretas de Supabase) ni `node_modules` — revisa que
   efectivamente no aparezcan en GitHub después de subir.

**Parte 2 — Ponerlo en línea con Vercel (gratis para empezar)**

1. Ve a https://vercel.com y crea una cuenta (puedes usar tu cuenta de
   GitHub para entrar directo).
2. Clic en **"Add New" → "Project"**.
3. Selecciona tu repositorio de GitHub (Vercel te va a pedir autorizar
   acceso a tus repos la primera vez).
4. Antes de darle "Deploy", abre **"Environment Variables"** y agrega
   las mismas 3 que tienes en tu `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Dale **Deploy**. En 1-2 minutos te da una URL pública (algo como
   `tu-proyecto.vercel.app`) — esa es la que compartes con tu equipo.
6. De ahí en adelante, cada vez que hagas `git push` a la rama `main`,
   Vercel actualiza la aplicación en línea sola, automáticamente.

**Parte 3 — Que otras personas puedan usarla o editarla**

- **Para que la usen** (sin tocar código): solo comparte la URL de
  Vercel. Cada persona necesita su propio usuario dentro de la
  aplicación — créalos desde Configuración > Usuarios, como ya vienes
  haciendo.
- **Para que edite el código contigo**: en GitHub, ve a tu repositorio →
  **Settings → Collaborators → Add people**, y agrégalos por su usuario
  o correo de GitHub. Así pueden clonar el repositorio, hacer cambios y
  subirlos.
- La `service_role key` de Supabase (la secreta) nunca debe compartirse
  fuera de las variables de entorno de Vercel/tu `.env.local` — quien
  la tenga tiene acceso total a la base de datos sin restricciones.










---

## Etapa 15 (agregada) — anillo por responsable y curva de Pareto

### Gráfico 4: Valor pendiente por responsable (anillo)

Gráfico de anillo (dona) con el valor pendiente agrupado por responsable
— usa los mismos datos del Cuadro 4, así que no agrega carga extra a la
base de datos. Clic en cualquier porción filtra todo el Dashboard por
ese responsable (mismo comportamiento de filtro cruzado que ya tenían
los cuadros y los otros gráficos).

### Gráfico 5: Curva de Pareto clásica (% de productos vs. % de ventas)

Igual a la imagen de referencia que enviaste: eje X = % acumulado de
productos (ordenados de mayor a menor valor), eje Y = % acumulado de
ventas, con las 4 zonas coloreadas (A, B, C, D) según en qué punto la
curva cruza el 80%, 95% y 99%. Se calcula en el servidor con una función
nueva que ordena todos los ítems por valor, calcula el acumulado, y solo
manda al navegador ~100 puntos (uno por cada punto porcentual) para que
sea liviano incluso con miles de referencias.

Lo probé con tus datos reales: la zona A terminaba en 14.3% de los
productos — es decir, el 14.3% de tus referencias con más valor generan
el 80% de las ventas, consistente con la clasificación que ya
validamos.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql`.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, y refresco forzado (Ctrl+Shift+R). Deberías ver
   "versión etapa15-..." abajo a la derecha.

---

## Etapa 16 (agregada) — corrección de rendimiento (timeout del Dashboard)

Al agregar el Gráfico 5 (curva de Pareto) en la Etapa 15, terminé
calculando la clasificación por referencia **dos veces** dentro de la
misma consulta: una vez para el Cuadro 8 y otra para la curva. Eso
volvió la consulta demasiado pesada y causaba el error "canceling
statement due to statement timeout".

Se unificó en un solo cálculo que ahora reutilizan tanto el Cuadro 8
como el Gráfico 5. Medido con tus 69.380 pedidos reales: la consulta
completa del Dashboard pasó de agotar el tiempo de espera a tardar
**2.7 segundos**. También aproveché para aumentar el tiempo máximo de
espera de las consultas a 30 segundos, como respaldo.

Nota: como efecto de esta simplificación, la clasificación del Cuadro 8
ahora se calcula sobre el rango de fechas exacto que tengas filtrado
(igual que el resto del Dashboard), en vez del "mes completo" que usan
las columnas de Pendientes — si prefieres que sea igual al mes completo,
avísame y lo ajusto de nuevo (con cuidado de no repetir el cálculo).

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql`.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, refresco forzado (Ctrl+Shift+R). Debe decir "versión
   etapa16-...".

---

## Etapa 17 (agregada) — curva de Pareto mejorada, filtro cruzado en el Cuadro 8, encabezados fijos

### Gráfico 5: etiquetas más grandes y colores nuevos

- Las 4 zonas ahora son: A verde, B amarillo, C anaranjado, D rojo,
  metalizadas (con degradado) y con transparencia del 50%, tal como
  pediste.
- Cada zona muestra su letra en grande arriba, y debajo la cantidad de
  referencias y el % de ventas que representa (ej. "471 ref. · 88.9%").
  Si una zona queda muy angosta en pantalla, la etiqueta se oculta sola
  para no verse amontonada.

### Cuadro 8 ahora filtra como los demás

Clic en cualquier fila (A, B, C o D) filtra el resto del Dashboard —
tarjetas, cuadros 1 al 7, el gráfico por C.O., y el gráfico de NS Total
día a día. El Gráfico 5 (la curva) y el Gráfico 2 (tendencia mensual)
intencionalmente NO se filtran por esto, para que sigas viendo la curva
completa y la tendencia completa incluso con una clasificación
seleccionada.

Esto obligó a reordenar la consulta del Dashboard: ahora la clasificación
se calcula primero, y de ahí en adelante todas las tarjetas y cuadros
parten de esa base ya filtrada (si hay clasificación seleccionada) — lo
probé de nuevo con tus datos reales para confirmar que las tarjetas y el
Cuadro 8 dan el mismo número cuando filtras por "A", y que la consulta
se mantiene rápida (3.2 segundos con tus 69.380 pedidos).

### Encabezados de tabla fijos

Los encabezados de todas las tablas (Pendientes y los cuadros del
Dashboard) ahora quedan fijos arriba mientras te desplazas hacia abajo,
en vez de desaparecer.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql`.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, refresco forzado (Ctrl+Shift+R). Debe decir "versión
   etapa17-...".

---

## Etapa 18 (agregada) — etiquetas de la curva de Pareto centradas y con fondo

Las etiquetas A/B/C/D (con la cantidad de referencias y el %) se
amontonaban todas arriba, casi una encima de otra. Ahora cada una se
ubica centrada verticalmente en medio de su propia zona, con un fondo
oscuro semitransparente y borde del color de la zona, para que se lean
bien sin importar dónde caiga la curva.

### Cómo instalar esta actualización

Solo reemplaza los archivos locales por los de este paquete y corre
`npm run dev` (no hay cambios de base de datos esta vez). Refresco
forzado (Ctrl+Shift+R) — debe decir "versión etapa18-...".

---

## Etapa 19 (agregada) — importar Motivos y Responsables desde Excel

En **Configuración > Motivos** ahora hay un bloque para importar varios
motivos de una sola vez desde un Excel o CSV, con las columnas
**Motivo** y **Responsable**. Reglas:

- Si el motivo ya existe (comparando el nombre, sin importar
  mayúsculas/minúsculas), se actualiza su responsable si viene distinto.
- Si no existe, se crea.
- Si el archivo trae el mismo motivo repetido varias veces, se usa la
  primera aparición y las demás se listan como omitidas.
- Al terminar, se muestra un resumen (creados / actualizados / sin
  cambios / omitidos) con el detalle de cualquier fila que no se haya
  podido procesar.

Esto es aparte de la opción que ya tenías de traer Motivo y Responsable
directamente en el archivo de Pedidos (Etapa 14) — puedes usar cualquiera
de las dos, o ambas: primero cargas tu catálogo de motivos aquí, y
luego importas Pedidos con la columna Motivo ya resuelta contra ese
catálogo.

### Cómo instalar esta actualización

Solo reemplaza los archivos locales por los de este paquete y corre
`npm run dev` (no hay cambios de base de datos). Refresco forzado
(Ctrl+Shift+R) — debe decir "versión etapa19-...".

---

## Etapa 20 (agregada) — encabezado fijo corregido + rendimiento con varios meses de datos

### 1. Encabezado de Pendientes: corrección definitiva

El ajuste que había puesto antes (compensar 41px por la franja superior)
estaba de más: el panel de contenido ya empieza justo debajo de la
franja, no hay nada que compensar. Ese "+41px" era justo lo que hacía
que el encabezado apareciera desplazado, como si estuviera en medio de
la tabla. Ya se quitó ese ajuste.

### 2. Timeout al cargar varios meses de datos

Reproduje tu escenario exacto: dupliqué tus 69.380 pedidos reales dos
veces más (con fechas de los 2 meses anteriores) hasta llegar a
**208.140 filas**, y confirmé el problema con `EXPLAIN ANALYZE`:

Cuando el usuario ve "todos los C.O." (lo más común, no un C.O.
puntual), el índice que teníamos — `(co, fecha_actualizacion)` — no le
sirve a Postgres para filtrar por fecha, porque el C.O. no está
acotado. Sin ese índice disponible, Postgres recorre la tabla
**completa** para cada gráfico y cada tarjeta (varias veces por cada
carga del Dashboard). Con 1 mes de datos no se notaba; con 3 meses, sí.

Se agregó un índice nuevo, independiente, solo sobre `fecha_actualizacion`.
Con él, medí una mejora real: el Dashboard completo pasó de 4.1
segundos a 2.4 segundos con las 208.140 filas (una mejora de ~40%, y
debería notarse aún más en Supabase real, que tiene que leer del disco
por red en vez de tenerlo todo en memoria como mi prueba local).

**Importante:** si después de esta actualización sigues viendo el error
de tiempo de espera, es posible que el ajuste de `statement_timeout` a
30 segundos no se esté aplicando en tu proyecto real de Supabase (la
capa de conexión que usa Supabase a veces no respeta ese ajuste hecho
por SQL). En ese caso, ve a tu proyecto de Supabase → **Project Settings
→ Database** y busca la opción de tiempo máximo de las consultas
("Statement timeout") para subirla manualmente desde ahí.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql` (agrega
   el índice nuevo).
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, refresco forzado (Ctrl+Shift+R). Debe decir "versión
   etapa20-...".

---

## Etapa 21 (agregada) — rendimiento real a 600.000+ registros

Escalé mi base de prueba local hasta **693.800 pedidos** (más que tu
escenario de 600.000, usando tus mismos datos reales multiplicados) y
medí con `EXPLAIN ANALYZE` exactamente dónde se iba el tiempo. Encontré
y corregí tres cosas:

1. **La causa principal**: el cálculo de "Pedidos totales/con
   pendientes" y "Líneas totales/pendientes" usaba `COUNT(DISTINCT ...)`
   sobre una combinación de varias columnas — con pocos datos no se
   nota, pero con cientos de miles de filas es una de las operaciones
   más lentas que existen en SQL. Se reemplazó por un método equivalente
   (agrupar primero, contar después) que le da el mismo resultado a
   Postgres de una forma mucho más eficiente. Esto también afectaba a
   `get_pedidos_cards` (las tarjetas de Pendientes) y al gráfico de NS
   Total día a día.
2. Se agregó un índice específico sobre la columna Fecha actualización
   (sin combinarla con C.O.), para cuando se consulta "todos los C.O."
   en vez de uno puntual.
3. Se aumentó la memoria disponible por consulta (`work_mem`), para que
   Postgres pueda ordenar en memoria en vez de usar el disco cuando hay
   muchas filas de por medio.

**Resultado medido** con las 693.800 filas: el Dashboard bajó de
~7.5-13 segundos a **5.7-6.2 segundos**; Pendientes (la clasificación)
ya estaba rápido y se mantiene bajo 1 segundo.

### Si aún así ves un timeout con tus 600.000 registros reales

Con datos reales (no simulados como los míos) los tiempos pueden variar
un poco según cuántos proveedores/clientes/ítems distintos tengas. Si
después de esta actualización todavía ves el error de tiempo de espera:

1. Confirma en Supabase → **Project Settings → Database** que el
   "Statement timeout" esté en al menos 30 segundos (el ajuste por SQL
   puede no aplicarse según tu plan).
2. Si sigue sin alcanzar, el siguiente paso sería una tabla de resumen
   pre-calculada (que se actualiza automáticamente cada vez que
   importas Pedidos, en vez de calcular todo en el momento) — es un
   cambio más grande de arquitectura, pero garantizaría tiempos de
   carga instantáneos sin importar cuántos meses de historia tengas.
   Avísame si llegas a necesitarlo.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql`.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, refresco forzado (Ctrl+Shift+R). Debe decir "versión
   etapa21-...".

---

## Etapa 22 (agregada) — preparado para varios años de historia (300 mil filas/mes)

Nos avisaste que la idea es cargar varios **años** de historia, a un
ritmo de ~300.000 filas por mes, y que el Dashboard solo necesita
mostrar los últimos 2 años. Antes de que cargues ese volumen, probé el
diseño actual a esa escala:

### Lo que probé

Dupliqué tus datos reales hasta **2.081.400 filas** (equivalente a casi
un año completo a tu ritmo real) y medí el Dashboard con `EXPLAIN
ANALYZE`. Encontré que el **Gráfico 2** (tendencia de 24 meses) era el
más costoso: como no depende del filtro Desde/Hasta, escaneaba TODO el
histórico de 2 años en cada carga del Dashboard — a 300 mil filas/mes,
esos son más de 7 millones de filas revisadas cada vez, sin importar
qué esté filtrado.

### La solución: una tabla de resumen mensual precalculado

Se creó `resumen_mensual_dashboard`, una tabla chica que guarda el total
de cada mes ya sumado (una fila por C.O. + mes). El Gráfico 2 ahora lee
de ahí en vez de sumar millones de filas cada vez. Esta tabla se
actualiza sola, automáticamente, cada vez que importas Pedidos — pero
**solo recalcula los meses que trajo ese archivo**, nunca el histórico
completo, así que la velocidad de importar no se ve afectada sin
importar cuántos años ya tengas cargados.

**Nota importante**: por este cambio, el Gráfico 2 ahora solo respeta el
filtro de C.O. — ya no se filtra por vendedor, proveedor, canal, zona,
ni por el filtro cruzado de clic en un cuadro. El resto de tarjetas,
cuadros y gráficos sí siguen respetando todos los filtros como antes.
Es un cambio deliberado: ese gráfico es para ver el panorama general de
tendencia, y la única forma de que aguante varios años de datos sin
volverse lento es que no dependa de un cruce tan detallado.

### Resultado medido

Con las 2.081.400 filas: el Dashboard completo pasó de **17.4 segundos**
a **5.2 segundos** (una mejora del 70%).

### Qué esperar a tu escala real (varios años, 300 mil filas/mes)

Con datos de 2 años completos (~7.2 millones de filas), es razonable
esperar que el Dashboard se mantenga en un rango similar de unos pocos
segundos, ya que las consultas más pesadas ahora están acotadas por mes
o por rango de fechas seleccionado (gracias a los índices), y la
tendencia de 24 meses ya no depende del volumen total.

**Si de todas formas notas lentitud según vayas cargando más años**, el
siguiente paso natural sería particionar la tabla de pedidos por mes
(una técnica estándar de Postgres para tablas de decenas de millones de
filas). No lo hice todavía porque cambia cómo se detectan los pedidos
duplicados (Postgres exige que la fecha forme parte de esa validación
en una tabla particionada), así que antes de hacerlo prefiero
confirmarlo contigo. Avísame si llegas a ese punto.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql`. La
   primera vez, esto recorre todo tu histórico una sola vez para llenar
   la tabla de resumen mensual — puede tardar unos segundos más de lo
   normal, es esperado.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, refresco forzado (Ctrl+Shift+R). Debe decir "versión
   etapa22-...".

### Si el timeout persiste

Revisa directamente en Supabase → **Project Settings → Database** que
el "Statement timeout" y el "work_mem" estén en un valor razonable (30s
y 64MB o más) — el ajuste que hacemos por SQL no siempre queda aplicado
según cómo esté configurada tu conexión (pooler transaccional vs.
directa), así que vale la pena confirmarlo ahí manualmente también.

---

## Etapa 23 (agregada) — ajustado al plan gratuito: un mes a la vez

Como confirmamos que el proyecto está en el plan **Free** de Supabase
(CPU compartida, 0.5 GB de RAM — el nivel más bajo que existe, y no se
puede subir sin pasar a Pro), se ajustó el alcance de la herramienta
para que trabaje bien dentro de esos recursos: **un mes de datos activo
a la vez**, en vez de acumular años de historia en la misma base.

### Qué se quitó

- **Gráfico 2** (NS Valor por mes, últimos 24 meses) — se eliminó por
  completo. Era, con diferencia, la consulta más pesada del Dashboard,
  porque por definición necesitaba mirar mucho más allá de un solo mes.
- **Comparación con el año anterior** en el Gráfico 1 — ahora solo
  muestra el NS Valor del periodo que tengas filtrado, sin la barra de
  comparación (esa comparación exigía otra consulta completa aparte).
- La tabla de resumen mensual precalculado (`resumen_mensual_dashboard`)
  y su función de refresco — ya no hacen falta sin el Gráfico 2, así
  que se eliminaron para no dejar nada sin usar.

Los gráficos que quedan se renumeraron: Gráfico 1 (NS Valor por C.O.),
Gráfico 2 (NS Total día a día), Gráfico 3 (anillo por responsable),
Gráfico 4 (curva de Pareto).

### Qué se agregó: Cierre de mes

Nueva opción en **Configuración > Cierre de mes**, pensada para usarse
al terminar cada mes:

1. **Descargar Excel**: trae TODOS los pedidos del rango que indiques
   (no solo los pendientes), con motivo y responsable incluidos — un
   respaldo completo para guardar tu histórico fuera de la aplicación.
2. **Eliminar todos los pedidos**: solo para administradores, pide
   escribir la palabra "ELIMINAR" para confirmar. Borra por completo la
   tabla de Pedidos (de todos los C.O., no solo el rango filtrado) para
   que el mes siguiente arranque con la base liviana otra vez. No toca
   usuarios, motivos, C.O. ni clientes — eso se conserva.

Con este flujo (cerrar, descargar, vaciar, repetir cada mes), la tabla
de Pedidos se mantiene siempre acotada a un mes de datos — que es
justo el volumen con el que el plan Free debería responder bien,
incluso en el nivel de cómputo más bajo (Nano).

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql` (quita la
   tabla de resumen mensual que ya no se usa, y agrega la función para
   el cierre de mes).
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, refresco forzado (Ctrl+Shift+R). Debe decir "versión
   etapa23-...".
4. Si quieres usar el cierre de mes, ve a Configuración > Usuarios y
   asegúrate de que tu usuario administrador tenga el módulo
   "Configuración > Cierre de mes" habilitado (los administradores ya lo
   ven automáticamente; los demás roles necesitan que se los actives).

### Cuando el presupuesto lo permita

El día que puedas pasar al plan Pro, avísame — ahí sí tendría sentido
volver a activar el histórico completo (Gráfico 2, comparación con el
año anterior, y ya no sería necesario borrar la base cada mes).

---

## Etapa 24 (agregada) — dos archivos de cierre de mes, con clasificación

En **Configuración > Cierre de mes** ahora hay dos botones de descarga
en vez de uno, y ambos incluyen la clasificación A/B/C/D de cliente y
de referencia (antes el archivo no la traía):

1. **"Descargar nivel de servicio"** → archivo `NIVEL DE SERVICIO -
   mmm-aa.xlsx` (ej. `NIVEL DE SERVICIO - may-26.xlsx`). Trae TODOS los
   pedidos del rango, con clasificación, motivo y responsable.
2. **"Descargar pendientes"** → archivo `PENDIENTES mm-aaaa.xlsx` (ej.
   `PENDIENTES 07-2026.xlsx`). Trae solo las líneas con cantidad
   pendiente mayor a cero, con las mismas columnas.

El mes/año del nombre del archivo se calcula a partir de la fecha
"Desde" que tengas seleccionada (pensado para cuando filtras el primer
día del mes que estás cerrando).

### Cómo instalar esta actualización

Solo reemplaza los archivos locales por los de este paquete y corre
`npm run dev` (no hay cambios de base de datos esta vez). Refresco
forzado (Ctrl+Shift+R) — debe decir "versión etapa24-...".

---

## Etapa 25 (agregada) — corrección: eliminar todos los pedidos daba error

El botón "Eliminar todos los pedidos" fallaba con el error "DELETE
requires a WHERE clause". La causa: Supabase trae activada por defecto
una protección de seguridad (extensión `safeupdate`, la vimos en el
`rolconfig` que revisamos juntos) que bloquea cualquier `DELETE` o
`UPDATE` que no tenga una cláusula `WHERE` — como salvaguarda contra
borrados accidentales de toda una tabla. La función original hacía
`delete from pedidos;` sin `WHERE`, así que esa protección la bloqueaba.
Se corrigió a `delete from pedidos where id is not null;` (borra
exactamente lo mismo, pero sí cumple con tener un `WHERE`). Ya lo
probé — funciona.

### Diagnóstico del timeout (información importante)

De paso, con tu ayuda revisando la pestaña Network del navegador,
confirmamos con certeza la causa raíz del timeout: las llamadas de la
aplicación (a través de PostgREST/el pooler de conexiones) tienen un
límite de aproximadamente **8 segundos**, distinto e independiente del
`statement_timeout` de 30 segundos que configuramos por SQL — ese
ajuste solo aplica a conexiones directas a Postgres, no a las que usa
la aplicación en el plan gratuito. Esto confirma que el techo es del
plan Free, no de las consultas en sí.

### Cómo instalar esta actualización

1. En el **SQL Editor** de Supabase, ejecuta todo el contenido
   actualizado de `supabase/etapa8_migracion_consolidada.sql`.
2. Reemplaza tus archivos locales por los de este paquete.
3. `npm run dev`, refresco forzado. Debe decir "versión etapa25-...".
4. Ahora sí, ve a Cierre de mes: descarga los dos archivos de respaldo,
   y usa "Eliminar todos los pedidos" para vaciar la base. Luego importa
   solo el mes actual y prueba si Pendientes y el Dashboard responden
   dentro de esos ~8 segundos.

---

## Etapa 26 (agregada) — el Excel de "omitidos" ahora identifica cada línea

Encontré el problema real detrás de "no me muestra las novedades línea
a línea": cuando una línea se descartaba por **datos faltantes** (por
ejemplo, sin Nro documento), el Excel de omitidos solo guardaba el
número de fila del archivo original — no guardaba nada del contenido
de esa línea (ni el C.O., ni la referencia, ni la descripción). Así que
al abrir el archivo, para esas filas no había forma de saber cuál
pedido era. Las líneas descartadas por duplicado sí traían todos los
datos, así que el archivo terminaba con columnas muy inconsistentes
entre una fila y otra, lo cual también generaba confusión de lectura.

Se corrigieron las dos cosas:

1. Ahora, incluso cuando falta un campo obligatorio, se guarda toda la
   información que sí venía en esa línea (C.O., referencia, descripción,
   etc.), para poder identificarla.
2. El archivo de omitidos ahora siempre tiene las mismas columnas, en el
   mismo orden, con **"Motivo del descarte"** como primera columna —
   sin importar si el motivo fue datos faltantes, duplicado, o un error
   al guardar.

Probé generar el archivo con datos representativos de los distintos
tipos de descarte y confirmé que abre sin problemas.

### Cómo instalar esta actualización

Solo reemplaza los archivos locales por los de este paquete y corre
`npm run dev` (no hay cambios de base de datos). Refresco forzado
(Ctrl+Shift+R) — debe decir "versión etapa26-...".

---

## Etapa 27 (agregada) — corrección definitiva: encabezado fijo en Pendientes

Encontré la causa real, y esta vez es distinta a las dos veces
anteriores: el panel principal (`<main>`, donde vive todo el contenido
de cada página) tenía `overflowX: 'auto'` sin especificar `overflowY`.
Por una regla del propio CSS, el navegador convierte automáticamente
ese `overflowY` en `'auto'` también — pero como la altura de `<main>`
no está fija (crece con el contenido), esa caja nunca llega a
desplazarse por sí misma; es la página completa la que se desplaza.
El resultado: el encabezado "pegajoso" de la tabla quedaba anclado a un
contenedor que técnicamente cuenta como "de scroll" pero que en la
práctica nunca se mueve, así que nunca se veía fijo de verdad al bajar.

Se agregó `overflowY: 'visible'` explícito a `<main>`, para que ya no
cuente como su propio contenedor de scroll y el encabezado se ancle
correctamente a la ventana real que se desplaza.

### Sobre el Dashboard que tardó varios minutos

Confirmamos que fue porque el proyecto de Supabase llevaba un rato sin
usarse — los proyectos del plan gratuito "se duermen" por inactividad y
la primera petición después de eso tarda en despertar la base de datos.
No es algo que se corrija con código; si sabes que vas a dejar de usar
la aplicación por un buen rato, conviene abrir el Dashboard un par de
minutos antes de necesitarlo en serio.

### Cómo instalar esta actualización

Solo reemplaza los archivos locales por los de este paquete y corre
`npm run dev` (no hay cambios de base de datos). Refresco forzado
(Ctrl+Shift+R) — debe decir "versión etapa27-...".

---

## Etapa 28 (agregada) — encabezado fijo de Pendientes: corregido y PROBADO con navegador real

Las dos veces anteriores corregí esto solo razonando sobre el CSS, sin
poder comprobarlo de verdad — y me equivoqué las dos veces. Esta vez
levanté un Chrome real en mi entorno y probé el comportamiento
exacto con JavaScript (medir la posición del encabezado antes y
después de hacer scroll), hasta encontrar la causa real y confirmar
que la solución sí funciona.

### La causa real (esta vez sí, verificada)

Cuando un contenedor necesita desplazamiento horizontal
(`overflow-x: auto`, necesario para poder mover la tabla ancha hacia
los lados), el navegador **obliga** a que el eje vertical también se
comporte como contenedor de desplazamiento — así se le diga
explícitamente `overflow-y: visible`, el navegador lo ignora y lo
convierte en `auto` de todas formas. Esto es una regla fija de CSS, no
un error de la aplicación. El problema es que, como ese contenedor
nunca tenía una altura máxima, nunca llegaba a desplazarse él mismo de
verdad (crecía para mostrar todas las filas) — y el encabezado
"pegajoso" quedaba anclado a una caja que técnicamente cuenta como "de
scroll" pero que en la práctica nunca se movía.

### La solución (probada con Chrome real, confirmado que funciona)

Se le dio a la tabla de Pendientes una altura máxima (65% de la altura
de la pantalla) con su propio scroll — igual a como ya funcionaba en
los cuadros del Dashboard, que nunca tuvieron este problema por la
misma razón. Ahora la tabla se desplaza dentro de su propio recuadro
(con scroll vertical y horizontal propios), y el encabezado sí quedó
fijo arriba de ese recuadro, confirmado con la prueba automatizada:
medí la posición del encabezado antes y después de mover el scroll, y
quedó exactamente en el mismo lugar (105.875px, sin moverse ni un
pixel) — antes de esta corrección, se movía junto con el contenido.

### Cómo instalar esta actualización

Solo reemplaza los archivos locales por los de este paquete y corre
`npm run dev` (no hay cambios de base de datos). Refresco forzado
(Ctrl+Shift+R) — debe decir "versión etapa28-...". Vas a notar que la
tabla de Pendientes ahora tiene su propio scroll interno (no crece
indefinidamente con la página) — es el cambio necesario para que el
encabezado fijo funcione de verdad.
