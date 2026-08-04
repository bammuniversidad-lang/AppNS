import { useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../../components/Layout';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { primerDiaMesActual, hoyISO } from '../../lib/fechas';

const TAMANO_PAGINA = 1000;

const MESES_ABREVIADOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

async function obtenerTodo(construirConsulta) {
  let desde = 0;
  let todas = [];
  while (true) {
    const { data, error } = await construirConsulta().range(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < TAMANO_PAGINA) break;
    desde += TAMANO_PAGINA;
  }
  return todas;
}

// "2026-05-01" -> "may-26"
function nombreMesAbreviado(fechaISO) {
  const [anio, mes] = fechaISO.split('-').map(Number);
  return `${MESES_ABREVIADOS[mes - 1]}-${String(anio).slice(2)}`;
}

// "2026-05-01" -> "05-2026"
function nombreMesNumero(fechaISO) {
  const [anio, mes] = fechaISO.split('-');
  return `${mes}-${anio}`;
}

export default function CierreMes({ tema, alternarTema }) {
  const { profile } = useAuth();
  const [fechaInicio, setFechaInicio] = useState(primerDiaMesActual());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [descargandoNivel, setDescargandoNivel] = useState(false);
  const [descargandoPendientes, setDescargandoPendientes] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [yaDescargo, setYaDescargo] = useState(false);
  const [confirmacion, setConfirmacion] = useState('');
  const [eliminando, setEliminando] = useState(false);

  const esAdmin = profile?.rol === 'administrador';

  async function obtenerFilasConClasificacion() {
    const [datos, { data: pc }, { data: pr }] = await Promise.all([
      obtenerTodo(() => {
        let q = supabase.from('v_pedidos_dashboard').select('*');
        if (fechaInicio) q = q.gte('fecha_actualizacion', fechaInicio);
        if (fechaFin) q = q.lte('fecha_actualizacion', fechaFin);
        return q;
      }),
      supabase.rpc('obtener_pareto_cliente', { fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null, co_list: null }),
      supabase.rpc('obtener_pareto_referencia', { fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null, co_list: null }),
    ]);

    const mapaCliente = new Map((pc || []).map((r) => [`${r.co}||${r.cliente}`, r.clasificacion_cliente]));
    const mapaReferencia = new Map((pr || []).map((r) => [`${r.co}||${r.item}`, r.clasificacion_referencia]));

    return datos.map((f) => ({
      ...f,
      clasificacion_cliente: mapaCliente.get(`${f.co}||${f.razon_social_cliente_despacho}`) || null,
      clasificacion_referencia: mapaReferencia.get(`${f.co}||${f.desc_item}`) || null,
    }));
  }

  function filaParaExcel(f) {
    return {
      'C.O.': f.co,
      Fecha: f.fecha,
      'Fecha actualizacion': f.fecha_actualizacion,
      'Nro documento': f.nro_documento,
      Bodega: f.bodega,
      PROVEEDOR: f.proveedor,
      Referencia: f.referencia,
      'Desc. item': f.desc_item,
      'Cant. pedida': f.cant_pedida,
      'Cant. remision': f.cant_remision,
      'Cant. pendiente': f.cant_pendiente,
      'Valor subtotal': f.valor_subtotal,
      'Cliente factura': f.cliente_factura,
      'Razon social cliente despacho': f.razon_social_cliente_despacho,
      'Nombre vendedor': f.nombre_vendedor,
      CANAL: f.canal,
      'Sucursal despacho': f.sucursal_despacho,
      'Clasificacion cliente': f.clasificacion_cliente,
      'Clasificacion referencia': f.clasificacion_referencia,
      Motivo: f.motivo_nombre,
      Responsable: f.responsable_motivo,
    };
  }

  function descargarExcel(filas, hojaNombre, nombreArchivo) {
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, hojaNombre);
    XLSX.writeFile(libro, nombreArchivo);
  }

  async function descargarNivelServicio() {
    setDescargandoNivel(true);
    setError('');
    setMensaje('');
    try {
      const datos = await obtenerFilasConClasificacion();
      const filas = datos.map(filaParaExcel);
      const nombreArchivo = `NIVEL DE SERVICIO - ${nombreMesAbreviado(fechaInicio)}.xlsx`;
      descargarExcel(filas, 'Nivel de servicio', nombreArchivo);
      setMensaje(`"${nombreArchivo}" descargado con ${filas.length} registros.`);
      setYaDescargo(true);
    } catch (e) {
      setError(e.message || 'Error descargando el nivel de servicio.');
    } finally {
      setDescargandoNivel(false);
    }
  }

  async function descargarPendientes() {
    setDescargandoPendientes(true);
    setError('');
    setMensaje('');
    try {
      const datos = await obtenerFilasConClasificacion();
      const filas = datos.filter((f) => Number(f.cant_pendiente) > 0).map(filaParaExcel);
      const nombreArchivo = `PENDIENTES ${nombreMesNumero(fechaInicio)}.xlsx`;
      descargarExcel(filas, 'Pendientes', nombreArchivo);
      setMensaje(`"${nombreArchivo}" descargado con ${filas.length} registros.`);
      setYaDescargo(true);
    } catch (e) {
      setError(e.message || 'Error descargando los pendientes.');
    } finally {
      setDescargandoPendientes(false);
    }
  }

  async function eliminarTodo() {
    setEliminando(true);
    setError('');
    setMensaje('');
    try {
      const { data, error } = await supabase.rpc('eliminar_todos_los_pedidos');
      if (error) throw error;
      setMensaje(`Se eliminaron ${data} pedidos. La base quedó vacía, lista para el nuevo mes.`);
      setYaDescargo(false);
      setConfirmacion('');
    } catch (e) {
      setError(e.message || 'Error eliminando los pedidos.');
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_cierre_mes">
      <h2>Cierre de mes</h2>
      <p style={{ opacity: 0.8, maxWidth: 700 }}>
        Esta herramienta existe porque la base de datos está en el plan gratuito de Supabase, que
        tiene poca capacidad de cómputo — mantener acumulados varios años de pedidos hace que el
        Dashboard y Pendientes se vuelvan lentos o se agote el tiempo de espera. La idea es que,
        al cerrar cada mes, descargues los dos archivos de abajo (para guardar tu histórico) y
        luego vacíes la base de Pedidos, para que el mes siguiente arranque liviano.
      </p>

      <div className="panel-dashboard" style={{ maxWidth: 640, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>1. Descargar el mes cerrado</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <label>Desde</label><br />
            <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
          </div>
          <div>
            <label>Hasta</label><br />
            <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11, opacity: 0.8, margin: '0 0 6px 0' }}>
            <b>Archivo 1 — "NIVEL DE SERVICIO - {nombreMesAbreviado(fechaInicio)}.xlsx"</b>: TODOS
            los pedidos del rango, con clasificación de cliente y referencia, y motivo/responsable
            cuando aplique.
          </p>
          <button onClick={descargarNivelServicio} disabled={descargandoNivel}>
            {descargandoNivel ? 'Descargando...' : 'Descargar nivel de servicio'}
          </button>
        </div>

        <div>
          <p style={{ fontSize: 11, opacity: 0.8, margin: '0 0 6px 0' }}>
            <b>Archivo 2 — "PENDIENTES {nombreMesNumero(fechaInicio)}.xlsx"</b>: solo las líneas con
            cantidad pendiente mayor a cero, con las mismas columnas (clasificación, motivo,
            responsable incluidos).
          </p>
          <button onClick={descargarPendientes} disabled={descargandoPendientes}>
            {descargandoPendientes ? 'Descargando...' : 'Descargar pendientes'}
          </button>
        </div>
      </div>

      {esAdmin ? (
        <div className="panel-dashboard" style={{ maxWidth: 640, borderColor: '#b71c1c' }}>
          <h3 style={{ marginTop: 0 }} className="error-text">2. Eliminar todos los pedidos (empezar mes nuevo)</h3>
          <p style={{ fontSize: 11, opacity: 0.8 }}>
            <b>Esta acción no se puede deshacer.</b> Borra TODA la tabla de Pedidos (de todos los
            C.O. y todas las fechas, no solo el rango de arriba). Los motivos, usuarios, C.O.,
            clientes y demás configuración NO se tocan. Asegúrate de haber descargado los dos
            archivos primero.
          </p>
          {!yaDescargo && (
            <p className="error-text" style={{ fontSize: 11 }}>
              Descarga los archivos de arriba primero para tener un respaldo (o si ya tienes el
              respaldo de otra forma, puedes continuar bajo tu propio criterio).
            </p>
          )}
          <div style={{ marginBottom: 10 }}>
            <label>Escribe ELIMINAR para confirmar</label><br />
            <input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} style={{ width: 200 }} />
          </div>
          <button
            onClick={eliminarTodo}
            disabled={eliminando || confirmacion !== 'ELIMINAR'}
            style={{ backgroundColor: '#b71c1c', color: '#fff', borderColor: '#7f0000' }}
          >
            {eliminando ? 'Eliminando...' : 'Eliminar todos los pedidos'}
          </button>
        </div>
      ) : (
        <p style={{ opacity: 0.7 }}>Solo un administrador puede eliminar los pedidos.</p>
      )}

      {mensaje && <p className="ok-text" style={{ marginTop: 12 }}>{mensaje}</p>}
      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    </Layout>
  );
}
