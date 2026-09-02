import { useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { leerArchivo, mapearFilasPedidos, mapearFilasClientes, mapearFilasVentasClasificacion, claveUnica } from '../lib/importUtils';

const TIPOS = [
  { valor: 'pedidos', etiqueta: 'Pedidos (acumulativa, valida duplicados)' },
  {
    valor: 'clasificacion_ventas',
    etiqueta: 'Clasificación A/B/C/D (Ventas de los últimos meses)',
    multiple: true,
    ayuda: (
      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4, maxWidth: 620 }}>
        <b>Ruta en el ERP:</b> Ventas → Consultas y reportes → Facturas y notas por ítems → Consulta &quot;BASE ABA CLAS&quot;.<br />
        <b>Observaciones:</b> se deben bajar los últimos 2 meses, un archivo por mes, en formato .xlsx.
        Selecciona los 2 archivos juntos (Ctrl+clic) antes de darle Importar.<br />
        <b>Frecuencia:</b> mensual. Cada vez que importes, se reemplaza la clasificación anterior por
        completo con lo que traigan los archivos que subas — no se acumula histórico, y el detalle de
        ventas nunca se guarda en la base de datos, solo el resultado (A/B/C/D) por cliente y por
        referencia.
      </div>
    ),
  },
  { valor: 'clientes', etiqueta: 'Clientes (reemplaza la data existente)' },
];

const TAMANO_LOTE = 500;

async function guardarLog(tipo, archivo, usuarioId, totales, insertados, omitidosDetalle, duracionMs) {
  await supabase.from('import_logs').insert({
    tipo,
    archivo,
    usuario_id: usuarioId,
    registros_totales: totales,
    registros_insertados: insertados,
    registros_omitidos: omitidosDetalle.length,
    errores: omitidosDetalle.map((o) => ({ fila: o.motivo, error: o.motivo })),
    omitidos_detalle: omitidosDetalle,
    duracion_ms: duracionMs,
  });
}

async function procesarPedidos(file, usuarioId) {
  const inicio = performance.now();
  const filasCrudas = await leerArchivo(file);
  const { filas, erroresFilas } = mapearFilasPedidos(filasCrudas);

  const omitidosDetalle = erroresFilas.map((e) => ({ motivo: e.error, fila: e.fila }));

  const porClave = new Map();
  for (const fila of filas) porClave.set(claveUnica(fila), fila);
  const filasUnicas = [...porClave.values()];
  if (filas.length - filasUnicas.length > 0) {
    omitidosDetalle.push({
      motivo: `${filas.length - filasUnicas.length} línea(s) venían repetidas dentro del mismo archivo (se conservó solo una copia de cada una)`,
    });
  }

  const nombresMotivo = [...new Set(
    filasUnicas.map((f) => f._motivo_nombre).filter((m) => m && String(m).trim() !== '')
  )].map((m) => String(m).trim());

  if (nombresMotivo.length > 0) {
    const { data: motivosExistentes } = await supabase.from('motivos').select('id,nombre');
    const mapaMotivos = new Map((motivosExistentes || []).map((m) => [m.nombre.toLowerCase(), m.id]));

    const faltantes = nombresMotivo.filter((n) => !mapaMotivos.has(n.toLowerCase()));
    if (faltantes.length > 0) {
      const nuevosMotivos = faltantes.map((nombre) => {
        const filaConEseMotivo = filasUnicas.find((f) => f._motivo_nombre && String(f._motivo_nombre).trim() === nombre);
        return { nombre, responsable: filaConEseMotivo?.responsable_motivo?.trim() || 'Sin responsable' };
      });
      const { data: creados, error: errCrear } = await supabase.from('motivos').insert(nuevosMotivos).select('id,nombre');
      if (!errCrear) {
        (creados || []).forEach((m) => mapaMotivos.set(m.nombre.toLowerCase(), m.id));
      } else {
        omitidosDetalle.push({ motivo: `No se pudieron crear algunos motivos nuevos: ${errCrear.message}` });
      }
    }

    for (const fila of filasUnicas) {
      if (fila._motivo_nombre && String(fila._motivo_nombre).trim() !== '') {
        const id = mapaMotivos.get(String(fila._motivo_nombre).trim().toLowerCase());
        if (id) {
          fila.motivo_id = id;
          fila.motivo_asignado_en = new Date().toISOString();
        }
      }
      delete fila._motivo_nombre;
    }
  } else {
    filasUnicas.forEach((f) => delete f._motivo_nombre);
  }

  let insertados = 0;
  for (let i = 0; i < filasUnicas.length; i += TAMANO_LOTE) {
    const lote = filasUnicas.slice(i, i + TAMANO_LOTE);
    const { data, error } = await supabase
      .from('pedidos')
      .upsert(lote, { onConflict: 'co,nro_documento,bodega,referencia', ignoreDuplicates: true })
      .select('co,nro_documento,bodega,referencia');

    if (error) {
      for (const fila of lote) {
        const { error: errFila } = await supabase
          .from('pedidos')
          .upsert([fila], { onConflict: 'co,nro_documento,bodega,referencia', ignoreDuplicates: true });
        if (errFila) {
          omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...fila });
        } else {
          insertados++;
        }
      }
    } else {
      const clavesInsertadas = new Set((data || []).map(claveUnica));
      insertados += clavesInsertadas.size;
      for (const fila of lote) {
        if (!clavesInsertadas.has(claveUnica(fila))) {
          omitidosDetalle.push({ motivo: 'Duplicado (ya existe en la base)', ...fila });
        }
      }
    }
  }

  const duracionMs = Math.round(performance.now() - inicio);
  await guardarLog('pedidos', file.name, usuarioId, filasCrudas.length, insertados, omitidosDetalle, duracionMs);

  return { tipo: 'Pedidos', archivo: file.name, totales: filasCrudas.length, insertados, omitidosDetalle, duracionMs };
}

async function procesarClientes(file, usuarioId) {
  const inicio = performance.now();
  const filasCrudas = await leerArchivo(file);
  const filas = mapearFilasClientes(filasCrudas);
  const omitidosDetalle = [];

  const { error: errBorrado } = await supabase.from('clientes').delete().gt('id', 0);
  if (errBorrado) throw errBorrado;

  const registros = filas.map((f) => ({ ...f, archivo_origen: file.name, cargado_por: usuarioId }));
  let insertados = 0;
  for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
    const lote = registros.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from('clientes').insert(lote);
    if (error) {
      for (const fila of lote) {
        const { error: errFila } = await supabase.from('clientes').insert([fila]);
        if (errFila) omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...fila });
        else insertados++;
      }
    } else {
      insertados += lote.length;
    }
  }

  const duracionMs = Math.round(performance.now() - inicio);
  await guardarLog('clientes', file.name, usuarioId, filasCrudas.length, insertados, omitidosDetalle, duracionMs);

  return { tipo: 'Clientes', archivo: file.name, totales: filasCrudas.length, insertados, omitidosDetalle, duracionMs };
}

// Calcula la clasificación A/B/C/D tipo Pareto, PARTICIONADO POR C.O.
// (cada C.O. tiene su propia clasificación independiente, igual que en
// el resto de la aplicación — no se mezclan los C.O. entre sí). Cuando
// se pide `conCurva`, también arma los puntos de la curva de Pareto
// (% de productos acumulado vs. % de ventas acumulado) para ese C.O.,
// muestreada a un punto por cada entero de % de productos, para que sea
// liviana.
function calcularClasificacionPareto(filas, coFn, claveFn, valorFn, conCurva) {
  const porCo = new Map(); // co -> Map(clave -> valor)
  for (const f of filas) {
    const co = coFn(f);
    const clave = claveFn(f);
    if (!co || !clave) continue;
    const valor = Number(valorFn(f)) || 0;
    if (!porCo.has(co)) porCo.set(co, new Map());
    const grupo = porCo.get(co);
    grupo.set(clave, (grupo.get(clave) || 0) + valor);
  }

  const clasificaciones = []; // { co, clave, clasificacion }
  const curvas = []; // { co, puntos, x_a, x_b, x_c }

  // Para armar también la curva "combinada" (Todos los C.O. juntos),
  // usando el mismo enfoque de partición pero con un solo grupo grande.
  const gruposParaCombinar = conCurva ? new Map() : null;

  for (const [co, grupo] of porCo.entries()) {
    const ordenado = [...grupo.entries()].sort((a, b) => b[1] - a[1]);
    const total = ordenado.reduce((s, [, v]) => s + v, 0);
    const totalItems = ordenado.length;
    let acumulado = 0;
    let xA = null;
    let xB = null;
    let xC = null;
    const puntosPorEntero = new Map();

    ordenado.forEach(([clave, valor], idx) => {
      acumulado += valor;
      const pctValor = total > 0 ? (acumulado / total) * 100 : 0;
      const pctItems = ((idx + 1) / totalItems) * 100;
      let clasificacion = 'D';
      if (pctValor <= 80) clasificacion = 'A';
      else if (pctValor <= 95) clasificacion = 'B';
      else if (pctValor <= 99) clasificacion = 'C';
      clasificaciones.push({ co, clave, clasificacion });

      if (xA === null && pctValor >= 80) xA = Math.round(pctItems * 100) / 100;
      if (xB === null && pctValor >= 95) xB = Math.round(pctItems * 100) / 100;
      if (xC === null && pctValor >= 99) xC = Math.round(pctItems * 100) / 100;

      if (conCurva) {
        puntosPorEntero.set(Math.floor(pctItems), {
          pct_items: Math.round(pctItems * 100) / 100,
          pct_valor: Math.round(pctValor * 100) / 100,
        });
        gruposParaCombinar.set(`${co}||${clave}`, valor);
      }
    });

    if (conCurva) {
      curvas.push({
        co,
        puntos: [...puntosPorEntero.values()].sort((a, b) => a.pct_items - b.pct_items),
        x_a: xA,
        x_b: xB,
        x_c: xC,
      });
    }
  }

  // Curva combinada de TODOS los C.O. juntos (para cuando el Dashboard
  // no tiene un solo C.O. específico filtrado).
  if (conCurva && gruposParaCombinar.size > 0) {
    const ordenado = [...gruposParaCombinar.entries()].sort((a, b) => b[1] - a[1]);
    const total = ordenado.reduce((s, [, v]) => s + v, 0);
    const totalItems = ordenado.length;
    let acumulado = 0;
    let xA = null;
    let xB = null;
    let xC = null;
    const puntosPorEntero = new Map();
    ordenado.forEach(([, valor], idx) => {
      acumulado += valor;
      const pctValor = total > 0 ? (acumulado / total) * 100 : 0;
      const pctItems = ((idx + 1) / totalItems) * 100;
      if (xA === null && pctValor >= 80) xA = Math.round(pctItems * 100) / 100;
      if (xB === null && pctValor >= 95) xB = Math.round(pctItems * 100) / 100;
      if (xC === null && pctValor >= 99) xC = Math.round(pctItems * 100) / 100;
      puntosPorEntero.set(Math.floor(pctItems), {
        pct_items: Math.round(pctItems * 100) / 100,
        pct_valor: Math.round(pctValor * 100) / 100,
      });
    });
    curvas.push({
      co: '__TODOS__',
      puntos: [...puntosPorEntero.values()].sort((a, b) => a.pct_items - b.pct_items),
      x_a: xA,
      x_b: xB,
      x_c: xC,
    });
  }

  return { clasificaciones, curvas };
}

// Procesa 1 o más archivos de Ventas: el cálculo de la clasificación se
// hace aquí, en el navegador, con TODAS las filas de los archivos que se
// suban juntos (2-3 meses). Solo el resultado final (A/B/C/D por cliente
// y por referencia, y la curva del Gráfico 4 ya resumida a ~100 puntos
// por C.O.) se sube a Supabase — el detalle de ventas fila por fila
// nunca se guarda, para no volver a golpear el almacenamiento ni el
// presupuesto de E/S de disco.
async function procesarClasificacionVentas(files, usuarioId) {
  const inicio = performance.now();
  const listaArchivos = Array.isArray(files) ? files : [files];

  let todasLasFilas = [];
  let totalFilasCrudas = 0;
  for (const file of listaArchivos) {
    const filasCrudas = await leerArchivo(file);
    totalFilasCrudas += filasCrudas.length;
    todasLasFilas = todasLasFilas.concat(mapearFilasVentasClasificacion(filasCrudas));
  }

  const { clasificaciones: clasifCliente } = calcularClasificacionPareto(
    todasLasFilas.filter((f) => f.cliente_factura && f.sucursal_despacho),
    (f) => f.co,
    (f) => `${f.cliente_factura}||${f.sucursal_despacho}`,
    (f) => f.costo_promedio_total,
    false
  );
  const { clasificaciones: clasifReferencia, curvas } = calcularClasificacionPareto(
    todasLasFilas.filter((f) => f.referencia),
    (f) => f.co,
    (f) => f.referencia,
    (f) => f.costo_promedio_total,
    true
  );

  const filasCliente = clasifCliente.map(({ co, clave, clasificacion }) => {
    const [cliente_factura, sucursal_despacho] = clave.split('||');
    return { co, cliente_factura, sucursal_despacho, clasificacion };
  });
  const filasReferencia = clasifReferencia.map(({ co, clave, clasificacion }) => ({ co, referencia: clave, clasificacion }));
  const filasCurva = curvas.map(({ co, puntos, x_a, x_b, x_c }) => ({ co, puntos, x_a, x_b, x_c }));

  const omitidosDetalle = [];

  // Se reemplaza por completo (no se acumula histórico): se borra lo
  // anterior y se sube el resultado nuevo.
  const { error: errBorrarCliente } = await supabase.from('clasificacion_cliente_ventas').delete().not('co', 'is', null);
  if (errBorrarCliente) throw errBorrarCliente;
  const { error: errBorrarReferencia } = await supabase.from('clasificacion_referencia_ventas').delete().not('co', 'is', null);
  if (errBorrarReferencia) throw errBorrarReferencia;
  const { error: errBorrarCurva } = await supabase.from('curva_pareto_ventas').delete().not('co', 'is', null);
  if (errBorrarCurva) throw errBorrarCurva;

  let insertados = 0;
  for (let i = 0; i < filasCliente.length; i += TAMANO_LOTE) {
    const lote = filasCliente.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from('clasificacion_cliente_ventas').insert(lote);
    if (error) omitidosDetalle.push({ motivo: `Error guardando clasificación de clientes: ${error.message}` });
    else insertados += lote.length;
  }
  for (let i = 0; i < filasReferencia.length; i += TAMANO_LOTE) {
    const lote = filasReferencia.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from('clasificacion_referencia_ventas').insert(lote);
    if (error) omitidosDetalle.push({ motivo: `Error guardando clasificación de referencias: ${error.message}` });
    else insertados += lote.length;
  }
  for (const filaCurva of filasCurva) {
    const { error } = await supabase.from('curva_pareto_ventas').insert(filaCurva);
    if (error) omitidosDetalle.push({ motivo: `Error guardando la curva de Pareto de C.O. ${filaCurva.co}: ${error.message}` });
    else insertados++;
  }

  const duracionMs = Math.round(performance.now() - inicio);
  const nombreArchivos = listaArchivos.map((f) => f.name).join(' + ');
  await guardarLog('clasificacion_ventas', nombreArchivos, usuarioId, totalFilasCrudas, insertados, omitidosDetalle, duracionMs);

  return {
    tipo: 'Clasificación (Ventas)',
    archivo: nombreArchivos,
    totales: totalFilasCrudas,
    insertados,
    omitidosDetalle,
    duracionMs,
    notaExtra: `${filasCliente.length} clientes y ${filasReferencia.length} referencias clasificadas, y la curva de Pareto de ${filasCurva.length - 1} C.O. (más la combinada) (a partir de ${totalFilasCrudas.toLocaleString('es-CO')} líneas de venta, que no se guardaron).`,
  };
}

function exportarOmitidos(resultado) {
  const filas = resultado.omitidosDetalle.map((o) => ({
    'Motivo del descarte': o.motivo || '',
    'Fila del archivo': o.fila ?? '',
    'C.O.': o.co ?? '',
    'Nro documento': o.nro_documento ?? '',
    Bodega: o.bodega ?? '',
    Proveedor: o.proveedor ?? '',
    Referencia: o.referencia ?? '',
    'Desc. item': o.desc_item ?? '',
    'Cant. pedida': o.cant_pedida ?? '',
    'Cant. remision': o.cant_remision ?? '',
    'Cant. pendiente': o.cant_pendiente ?? '',
    'Valor subtotal': o.valor_subtotal ?? '',
    'Razon social cliente despacho': o.razon_social_cliente_despacho ?? '',
    'Nombre vendedor': o.nombre_vendedor ?? '',
  }));
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Omitidos');
  XLSX.writeFile(libro, `omitidos_${resultado.tipo}_${resultado.archivo}.xlsx`);
}

function procesar(tipoValor, archivo, usuarioId) {
  if (tipoValor === 'pedidos') return procesarPedidos(archivo, usuarioId);
  if (tipoValor === 'clientes') return procesarClientes(archivo, usuarioId);
  if (tipoValor === 'clasificacion_ventas') return procesarClasificacionVentas(archivo, usuarioId);
  return null;
}

export default function Importar({ tema, alternarTema }) {
  const { session } = useAuth();
  const [archivos, setArchivos] = useState({});
  const [procesando, setProcesando] = useState({});
  const [resultados, setResultados] = useState([]);
  const [errores, setErrores] = useState({});

  async function manejarImportar(tipoValor) {
    const archivo = archivos[tipoValor];
    if (!archivo || (Array.isArray(archivo) && archivo.length === 0)) return;
    setProcesando((p) => ({ ...p, [tipoValor]: true }));
    setErrores((e) => ({ ...e, [tipoValor]: '' }));
    try {
      const usuarioId = session?.user?.id;
      const resultado = await procesar(tipoValor, archivo, usuarioId);
      setResultados((prev) => [resultado, ...prev]);
      setArchivos((prev) => ({ ...prev, [tipoValor]: null }));
    } catch (e) {
      setErrores((prev) => ({ ...prev, [tipoValor]: e.message || 'Error desconocido al importar.' }));
    } finally {
      setProcesando((p) => ({ ...p, [tipoValor]: false }));
    }
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="importar">
      <h2>Importar bases de datos</h2>

      <div className="panel-dashboard" style={{ marginBottom: 20 }}>
        {TIPOS.map((t) => (
          <div key={t.valor} className="fila-importar" style={{ flexWrap: 'wrap' }}>
            <span className="fila-importar-etiqueta">{t.etiqueta}</span>
            <input
              type="file"
              multiple={!!t.multiple}
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setArchivos((prev) => ({ ...prev, [t.valor]: t.multiple ? Array.from(e.target.files) : e.target.files[0] }))}
            />
            <button onClick={() => manejarImportar(t.valor)} disabled={!archivos[t.valor] || procesando[t.valor]}>
              {procesando[t.valor] ? 'Procesando...' : 'Importar'}
            </button>
            {errores[t.valor] && <span className="error-text">{errores[t.valor]}</span>}
            {t.ayuda}
            {t.multiple && Array.isArray(archivos[t.valor]) && archivos[t.valor].length > 0 && (
              <span style={{ fontSize: 11, opacity: 0.8, width: '100%' }}>
                Archivos seleccionados: {archivos[t.valor].map((f) => f.name).join(', ')}
              </span>
            )}
          </div>
        ))}
      </div>

      {resultados.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Base</th>
              <th>Archivo</th>
              <th>Tiempo</th>
              <th>Registros en archivo</th>
              <th>Insertados</th>
              <th>Omitidos</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {resultados.map((r, i) => (
              <tr key={i}>
                <td>{r.tipo}</td>
                <td>{r.archivo}</td>
                <td>{(r.duracionMs / 1000).toFixed(2)} s</td>
                <td>{r.totales}</td>
                <td className="ok-text">{r.insertados}</td>
                <td>{r.omitidosDetalle.length}</td>
                <td>
                  {r.notaExtra && <p style={{ fontSize: 11, opacity: 0.8, margin: '0 0 6px 0' }}>{r.notaExtra}</p>}
                  {r.omitidosDetalle.length === 0 ? (
                    r.notaExtra ? '' : '-'
                  ) : (
                    <div>
                      <details>
                        <summary className="error-text">{r.omitidosDetalle.length} línea(s) omitida(s)</summary>
                        <ul>
                          {r.omitidosDetalle.slice(0, 30).map((o, j) => (
                            <li key={j}>{o.motivo}{o.co ? ` (C.O. ${o.co}${o.nro_documento ? `, doc ${o.nro_documento}` : ''}${o.referencia ? `, ref ${o.referencia}` : ''})` : ''}</li>
                          ))}
                        </ul>
                        {r.omitidosDetalle.length > 30 && <p style={{ opacity: 0.7 }}>Mostrando 30 de {r.omitidosDetalle.length}. Descarga el Excel para verlas todas.</p>}
                      </details>
                      {r.tipo !== 'Clasificación (Ventas)' && <button onClick={() => exportarOmitidos(r)}>Descargar omitidos en Excel</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
