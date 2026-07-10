import { useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { leerArchivo, mapearFilasPedidos, mapearFilasClientes, claveUnica } from '../lib/importUtils';

const TIPOS = [
  { valor: 'pedidos', etiqueta: 'Pedidos (acumulativa, valida duplicados)' },
  { valor: 'ventas', etiqueta: 'Ventas (acumulativa)' },
  { valor: 'inventario', etiqueta: 'Inventario (reemplaza la data existente)' },
  { valor: 'referencias', etiqueta: 'Referencia (reemplaza la data existente)' },
  { valor: 'entradas', etiqueta: 'Entradas (acumulativa)' },
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

  // Si el mismo archivo trae la misma línea repetida, nos quedamos con una sola.
  const porClave = new Map();
  for (const fila of filas) porClave.set(claveUnica(fila), fila);
  const filasUnicas = [...porClave.values()];
  if (filas.length - filasUnicas.length > 0) {
    omitidosDetalle.push({
      motivo: `${filas.length - filasUnicas.length} línea(s) venían repetidas dentro del mismo archivo (se conservó solo una copia de cada una)`,
    });
  }

  // Se sube con "upsert ... ignoreDuplicates" para que sea la base de datos
  // (no la aplicación) la que descarte los duplicados que ya existían. Esto
  // evita tener que traer y comparar todas las llaves existentes, que era
  // lento y además se topaba con el límite de 1000 filas por consulta.
  let insertados = 0;
  for (let i = 0; i < filasUnicas.length; i += TAMANO_LOTE) {
    const lote = filasUnicas.slice(i, i + TAMANO_LOTE);
    const { data, error } = await supabase
      .from('pedidos')
      .upsert(lote, { onConflict: 'co,nro_documento,bodega,referencia', ignoreDuplicates: true })
      .select('co,nro_documento,bodega,referencia');

    if (error) {
      // Un error real (no un simple duplicado) en el lote: se reintenta
      // fila por fila SOLO ese lote de 500, para saber cuál fila fue.
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

  if (insertados > 0) {
    // Actualiza la clasificación Pareto (A/B/C/D) para que Pendientes y el
    // Dashboard reflejen los pedidos recién importados. No bloquea el
    // resultado de la importación si llegara a fallar.
    supabase.rpc('refrescar_pareto').then(({ error }) => {
      if (error) console.error('No se pudo refrescar la clasificación Pareto:', error.message);
    });
  }

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

async function procesarAcumulativaGenerica(file, tabla, etiqueta, usuarioId) {
  const inicio = performance.now();
  const filas = await leerArchivo(file);
  const omitidosDetalle = [];
  const registros = filas.map((f) => ({ data: f, archivo_origen: file.name, cargado_por: usuarioId }));

  let insertados = 0;
  for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
    const lote = registros.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from(tabla).insert(lote);
    if (error) {
      for (let j = 0; j < lote.length; j++) {
        const { error: errFila } = await supabase.from(tabla).insert([lote[j]]);
        if (errFila) omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...filas[i + j] });
        else insertados++;
      }
    } else {
      insertados += lote.length;
    }
  }

  const duracionMs = Math.round(performance.now() - inicio);
  await guardarLog(tabla, file.name, usuarioId, filas.length, insertados, omitidosDetalle, duracionMs);

  return { tipo: etiqueta, archivo: file.name, totales: filas.length, insertados, omitidosDetalle, duracionMs };
}

async function procesarReemplazoGenerico(file, tabla, etiqueta, usuarioId) {
  const inicio = performance.now();
  const filas = await leerArchivo(file);
  const omitidosDetalle = [];

  const { error: errBorrado } = await supabase.from(tabla).delete().gt('id', 0);
  if (errBorrado) throw errBorrado;

  const registros = filas.map((f) => ({ data: f, archivo_origen: file.name, cargado_por: usuarioId }));
  let insertados = 0;
  for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
    const lote = registros.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from(tabla).insert(lote);
    if (error) {
      for (let j = 0; j < lote.length; j++) {
        const { error: errFila } = await supabase.from(tabla).insert([lote[j]]);
        if (errFila) omitidosDetalle.push({ motivo: `Error al guardar: ${errFila.message}`, ...filas[i + j] });
        else insertados++;
      }
    } else {
      insertados += lote.length;
    }
  }

  const duracionMs = Math.round(performance.now() - inicio);
  await guardarLog(tabla, file.name, usuarioId, filas.length, insertados, omitidosDetalle, duracionMs);

  return { tipo: etiqueta, archivo: file.name, totales: filas.length, insertados, omitidosDetalle, duracionMs };
}

function exportarOmitidos(resultado) {
  const hoja = XLSX.utils.json_to_sheet(resultado.omitidosDetalle);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Omitidos');
  XLSX.writeFile(libro, `omitidos_${resultado.tipo}_${resultado.archivo}.xlsx`);
}

function procesar(tipoValor, archivo, usuarioId) {
  if (tipoValor === 'pedidos') return procesarPedidos(archivo, usuarioId);
  if (tipoValor === 'clientes') return procesarClientes(archivo, usuarioId);
  if (tipoValor === 'ventas') return procesarAcumulativaGenerica(archivo, 'ventas', 'Ventas', usuarioId);
  if (tipoValor === 'entradas') return procesarAcumulativaGenerica(archivo, 'entradas', 'Entradas', usuarioId);
  if (tipoValor === 'inventario') return procesarReemplazoGenerico(archivo, 'inventario', 'Inventario', usuarioId);
  if (tipoValor === 'referencias') return procesarReemplazoGenerico(archivo, 'referencias', 'Referencia', usuarioId);
  return null;
}

export default function Importar({ tema, alternarTema }) {
  const { session } = useAuth();
  const [archivos, setArchivos] = useState({}); // { pedidos: File, ventas: File, ... }
  const [procesando, setProcesando] = useState({}); // { pedidos: true/false, ... }
  const [resultados, setResultados] = useState([]);
  const [errores, setErrores] = useState({});

  async function manejarImportar(tipoValor) {
    const archivo = archivos[tipoValor];
    if (!archivo) return;
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
          <div key={t.valor} className="fila-importar">
            <span className="fila-importar-etiqueta">{t.etiqueta}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setArchivos((prev) => ({ ...prev, [t.valor]: e.target.files[0] }))}
            />
            <button onClick={() => manejarImportar(t.valor)} disabled={!archivos[t.valor] || procesando[t.valor]}>
              {procesando[t.valor] ? 'Procesando...' : 'Importar'}
            </button>
            {errores[t.valor] && <span className="error-text">{errores[t.valor]}</span>}
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
                  {r.omitidosDetalle.length === 0 ? (
                    '-'
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
                      <button onClick={() => exportarOmitidos(r)}>Descargar omitidos en Excel</button>
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
