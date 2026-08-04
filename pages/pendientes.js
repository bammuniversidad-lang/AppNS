import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Layout from '../components/Layout';
import { ThOrdenable, useOrdenTabla } from '../components/TablaHeader';
import TarjetasResumen from '../components/Tarjetas';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { primerDiaMesActual, hoyISO } from '../lib/fechas';

const COLUMNAS = [
  { clave: 'co', etiqueta: 'C.O.' },
  { clave: 'fecha_actualizacion', etiqueta: 'Fecha actualización' },
  { clave: 'nro_documento', etiqueta: 'Nro documento' },
  { clave: 'bodega', etiqueta: 'Bodega' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'referencia', etiqueta: 'Referencia' },
  { clave: 'desc_item', etiqueta: 'Desc. item' },
  { clave: 'cant_pedida', etiqueta: 'Cant. pedida' },
  { clave: 'cant_remision', etiqueta: 'Cant. remisión' },
  { clave: 'cant_pendiente', etiqueta: 'Cant. pendiente' },
  { clave: 'valor_subtotal', etiqueta: 'Valor subtotal' },
  { clave: 'razon_social_cliente_despacho', etiqueta: 'Razón social cliente' },
  { clave: 'nombre_vendedor', etiqueta: 'Nombre vendedor' },
  { clave: 'clasificacion_cliente', etiqueta: 'Clasif. cliente' },
  { clave: 'clasificacion_referencia', etiqueta: 'Clasif. referencia' },
  { clave: 'motivo_nombre', etiqueta: 'Motivo' },
  { clave: 'responsable_motivo', etiqueta: 'Responsable' },
];

export default function Pendientes({ tema, alternarTema }) {
  const { profile, session } = useAuth();
  const [filas, setFilas] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [tarjetas, setTarjetas] = useState(null);
  const [fechaInicio, setFechaInicio] = useState(primerDiaMesActual());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [soloSinMotivo, setSoloSinMotivo] = useState(false);
  const [columnasOcultas, setColumnasOcultas] = useState([]);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [motivoMasivo, setMotivoMasivo] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [anchos, setAnchos] = useState({});
  const [orden, setOrden] = useState(null);
  const ordenarFilas = useOrdenTabla();

  const scrollSuperior = useRef(null);
  const scrollTabla = useRef(null);
  const sincronizando = useRef(false);

  function sincronizarDesdeArriba() {
    if (sincronizando.current) return;
    sincronizando.current = true;
    if (scrollTabla.current) scrollTabla.current.scrollLeft = scrollSuperior.current.scrollLeft;
    sincronizando.current = false;
  }

  function sincronizarDesdeTabla() {
    if (sincronizando.current) return;
    sincronizando.current = true;
    if (scrollSuperior.current) scrollSuperior.current.scrollLeft = scrollTabla.current.scrollLeft;
    sincronizando.current = false;
  }

  function alRedimensionar(clave, ancho) {
    setAnchos((prev) => ({ ...prev, [clave]: ancho }));
  }

  function alOrdenar(clave) {
    setOrden((prev) => {
      if (prev?.clave === clave) {
        return { clave, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' };
      }
      return { clave, direccion: 'asc' };
    });
  }

  const cosPermitidos = profile?.rol === 'administrador' || profile?.ve_todos_co
    ? null
    : profile?.cos_permitidos || [];

  async function cargarMotivos() {
    const { data } = await supabase.from('motivos').select('*').order('nombre');
    setMotivos(data || []);
  }

  async function cargarPendientes() {
    setCargando(true);
    let consulta = supabase.from('v_pendientes').select('*');
    if (fechaInicio) consulta = consulta.gte('fecha_actualizacion', fechaInicio);
    if (fechaFin) consulta = consulta.lte('fecha_actualizacion', fechaFin);
    if (soloSinMotivo) consulta = consulta.is('motivo_id', null);
    if (cosPermitidos) consulta = consulta.in('co', cosPermitidos.length ? cosPermitidos : ['__ninguno__']);

    const co_list = cosPermitidos && cosPermitidos.length ? cosPermitidos : null;

    const [
      { data, error },
      { data: pc, error: errorPc },
      { data: pr, error: errorPr },
    ] = await Promise.all([
      consulta.order('co', { ascending: true }).order('referencia', { ascending: true }),
      supabase.rpc('obtener_pareto_cliente', { fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null, co_list }),
      supabase.rpc('obtener_pareto_referencia', { fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null, co_list }),
    ]);

    if (errorPc || errorPr) {
      setMensaje(`No se pudo calcular la clasificación: ${errorPc?.message || errorPr?.message}`);
    }

    if (!error) {
      const mapaCliente = new Map((pc || []).map((r) => [`${r.co}||${r.cliente}`, r.clasificacion_cliente]));
      const mapaReferencia = new Map((pr || []).map((r) => [`${r.co}||${r.item}`, r.clasificacion_referencia]));
      const filasConClasificacion = (data || []).map((f) => ({
        ...f,
        clasificacion_cliente: mapaCliente.get(`${f.co}||${f.razon_social_cliente_despacho}`) || null,
        clasificacion_referencia: mapaReferencia.get(`${f.co}||${f.desc_item}`) || null,
      }));
      setFilas(filasConClasificacion);
    } else {
      setMensaje(`Error cargando pendientes: ${error.message}`);
    }
    setCargando(false);
  }

  async function cargarTarjetas() {
    const { data, error } = await supabase.rpc('get_pedidos_cards', {
      co_list: cosPermitidos && cosPermitidos.length ? cosPermitidos : null,
      fecha_inicio: fechaInicio || null,
      fecha_fin: fechaFin || null,
      solo_sin_motivo: soloSinMotivo,
    });
    if (!error) setTarjetas(data?.[0] || null);
  }

  useEffect(() => {
    cargarMotivos();
  }, []);

  useEffect(() => {
    if (profile) {
      cargarPendientes();
      cargarTarjetas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, fechaInicio, fechaFin, soloSinMotivo]);

  function alternarColumna(clave) {
    setColumnasOcultas((prev) =>
      prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]
    );
  }

  function alternarSeleccion(id) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  async function asignarMotivo(idsPedidos, motivoId) {
    const motivo = motivos.find((m) => String(m.id) === String(motivoId));
    if (!motivo) return;
    const { error } = await supabase
      .from('pedidos')
      .update({
        motivo_id: motivo.id,
        responsable_motivo: motivo.responsable,
        motivo_asignado_en: new Date().toISOString(),
        motivo_asignado_por: session?.user?.id,
      })
      .in('id', idsPedidos);

    if (error) {
      setMensaje(`Error asignando motivo: ${error.message}`);
    } else {
      setMensaje('Motivo asignado correctamente.');
      setSeleccionados(new Set());
      cargarPendientes();
      cargarTarjetas();
    }
  }

  function exportar() {
    const datos = filas.map((f) => ({
      'C.O.': f.co,
      'Fecha actualización': f.fecha_actualizacion,
      'Nro documento': f.nro_documento,
      Bodega: f.bodega,
      Proveedor: f.proveedor,
      Referencia: f.referencia,
      'Desc. item': f.desc_item,
      'Cant. pedida': f.cant_pedida,
      'Cant. remisión': f.cant_remision,
      'Cant. pendiente': f.cant_pendiente,
      'Valor subtotal': f.valor_subtotal,
      'Razón social cliente': f.razon_social_cliente_despacho,
      'Nombre vendedor': f.nombre_vendedor,
      'Clasificación cliente': f.clasificacion_cliente,
      'Clasificación referencia': f.clasificacion_referencia,
      Motivo: f.motivo_nombre,
      Responsable: f.responsable_motivo,
    }));
    const hoja = XLSX.utils.json_to_sheet(datos);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Pendientes');
    const nombreArchivo = `pendientes_${fechaInicio || 'inicio'}_a_${fechaFin || 'hoy'}.xlsx`;
    XLSX.writeFile(libro, nombreArchivo);
  }

  const columnasVisibles = useMemo(
    () => COLUMNAS.filter((c) => !columnasOcultas.includes(c.clave)),
    [columnasOcultas]
  );

  const filasOrdenadas = useMemo(() => ordenarFilas(filas, orden), [filas, orden]);
  const anchoTotalTabla = 32 + 160 + columnasVisibles.reduce((suma, c) => suma + (anchos[c.clave] || 140), 0);

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="pendientes">
      <h2>Pendientes</h2>

      <TarjetasResumen tarjetas={tarjetas} />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <label>Desde</label><br />
          <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </div>
        <div>
          <label>Hasta</label><br />
          <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        </div>
        <label style={{ marginTop: 16 }}>
          <input type="checkbox" checked={soloSinMotivo} onChange={(e) => setSoloSinMotivo(e.target.checked)} />
          {' '}Solo sin motivo
        </label>
        <button style={{ marginTop: 16 }} onClick={exportar}>Descargar Excel</button>
        <button
          style={{ marginTop: 16 }}
          onClick={() => { cargarPendientes(); cargarTarjetas(); }}
          disabled={cargando}
          title="Vuelve a consultar Pendientes y la clasificación con los datos más recientes"
        >
          {cargando ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <details style={{ marginBottom: 10 }}>
        <summary>Mostrar/ocultar columnas</summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {COLUMNAS.map((c) => (
            <label key={c.clave} style={{ border: '1px solid #999', borderRadius: 3, padding: '2px 6px' }}>
              <input
                type="checkbox"
                checked={!columnasOcultas.includes(c.clave)}
                onChange={() => alternarColumna(c.clave)}
              />
              {' '}{c.etiqueta}
            </label>
          ))}
        </div>
      </details>

      {seleccionados.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span>{seleccionados.size} fila(s) seleccionada(s)</span>
          <select value={motivoMasivo} onChange={(e) => setMotivoMasivo(e.target.value)}>
            <option value="">Asignar motivo...</option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre} ({m.responsable})</option>
            ))}
          </select>
          <button
            disabled={!motivoMasivo}
            onClick={() => asignarMotivo([...seleccionados], motivoMasivo)}
          >
            Aplicar a selección
          </button>
        </div>
      )}

      {mensaje && <p>{mensaje}</p>}
      {cargando && <p className="indicador-actualizando">Actualizando...</p>}

      {/* Barra de scroll horizontal arriba de la tabla, sincronizada, para
          no tener que bajar hasta el final para moverse a los lados. */}
      <div ref={scrollSuperior} onScroll={sincronizarDesdeArriba} className="scroll-superior">
        <div style={{ width: anchoTotalTabla, height: 1 }} />
      </div>

      <div ref={scrollTabla} onScroll={sincronizarDesdeTabla} className="tabla-pagina-scroll" style={{ overflow: 'auto', maxHeight: '65vh' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              {columnasVisibles.map((c) => (
                <ThOrdenable
                  key={c.clave}
                  clave={c.clave}
                  etiqueta={c.etiqueta}
                  ancho={anchos[c.clave] || 140}
                  alRedimensionar={alRedimensionar}
                  orden={orden}
                  alOrdenar={alOrdenar}
                />
              ))}
              <th style={{ width: 160 }}>Asignar motivo</th>
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.map((f) => (
              <tr key={f.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={seleccionados.has(f.id)}
                    onChange={() => alternarSeleccion(f.id)}
                  />
                </td>
                {columnasVisibles.map((c) => (
                  <td key={c.clave} style={{ width: anchos[c.clave] || 140, maxWidth: anchos[c.clave] || 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.clave === 'clasificacion_cliente' || c.clave === 'clasificacion_referencia' ? (
                      f[c.clave] ? <span className={`badge badge-${f[c.clave]}`}>{f[c.clave]}</span> : '-'
                    ) : (
                      f[c.clave] ?? '-'
                    )}
                  </td>
                ))}
                <td>
                  <select
                    value={f.motivo_id || ''}
                    onChange={(e) => asignarMotivo([f.id], e.target.value)}
                  >
                    <option value="">Sin motivo</option>
                    {motivos.map((m) => (
                      <option key={m.id} value={m.id}>{m.nombre}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
