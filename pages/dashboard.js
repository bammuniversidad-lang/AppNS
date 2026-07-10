import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line,
} from 'recharts';
import Layout from '../components/Layout';
import CuadroDashboard from '../components/CuadroDashboard';
import TarjetasResumen from '../components/Tarjetas';
import ErrorBoundary from '../components/ErrorBoundary';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  agruparValorFacturado, agruparResponsableMotivo, agruparItemPendiente, calcularNsPorCO, calcularNsPorMes,
  calcularTarjetasPedidos,
} from '../lib/dashboardUtils';

const TAMANO_PAGINA = 1000;
const LIMITE_FILAS_EXCEL = 100000; // por encima de esto, se exporta CSV en vez de xlsx

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

function unAnioAntes(fechaISO) {
  if (!fechaISO) return null;
  const [a, m, d] = fechaISO.split('-').map(Number);
  return `${a - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const moneda = (v) => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
const porcentaje = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;

export default function Dashboard({ tema, alternarTema }) {
  const { profile } = useAuth();
  const [filtros, setFiltros] = useState({
    co: '', fechaInicio: '', fechaFin: '', razonSocialSucursal: '', vendedor: '', proveedor: '', descItem: '', canal: '', zona: '',
  });
  const [cosDisponibles, setCosDisponibles] = useState([]);
  const [canalesDisponibles, setCanalesDisponibles] = useState([]);
  const [zonasDisponibles, setZonasDisponibles] = useState([]);
  const [filas, setFilas] = useState([]);
  const [filasAnioAnterior, setFilasAnioAnterior] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState('');

  const cosPermitidos = profile?.rol === 'administrador' || profile?.ve_todos_co
    ? null
    : profile?.cos_permitidos || [];

  useEffect(() => {
    (async () => {
      const [{ data: cosTabla }, { data: cosPedidos }, { data: clientesCanal }, { data: clientesZona }] = await Promise.all([
        supabase.from('cos').select('codigo'),
        supabase.from('pedidos').select('co'),
        supabase.from('clientes').select('canal'),
        supabase.from('clientes').select('zona'),
      ]);
      setCosDisponibles([...new Set([...(cosTabla || []).map((r) => r.codigo), ...(cosPedidos || []).map((r) => r.co)])].sort());
      setCanalesDisponibles([...new Set((clientesCanal || []).map((r) => r.canal).filter(Boolean))].sort());
      setZonasDisponibles([...new Set((clientesZona || []).map((r) => r.zona).filter(Boolean))].sort());
    })();
  }, []);

  function construirConsultaBase(tabla) {
    return () => {
      let q = supabase.from(tabla).select('*');
      if (filtros.co) q = q.eq('co', filtros.co);
      else if (cosPermitidos) q = q.in('co', cosPermitidos.length ? cosPermitidos : ['__ninguno__']);
      if (filtros.fechaInicio) q = q.gte('fecha_actualizacion', filtros.fechaInicio);
      if (filtros.fechaFin) q = q.lte('fecha_actualizacion', filtros.fechaFin);
      if (filtros.razonSocialSucursal) q = q.ilike('razon_social_sucursal', `%${filtros.razonSocialSucursal}%`);
      if (filtros.vendedor) q = q.ilike('nombre_vendedor', `%${filtros.vendedor}%`);
      if (filtros.proveedor) q = q.ilike('proveedor', `%${filtros.proveedor}%`);
      if (filtros.descItem) q = q.ilike('desc_item', `%${filtros.descItem}%`);
      if (filtros.canal) q = q.eq('cliente_canal', filtros.canal);
      if (filtros.zona) q = q.eq('cliente_zona', filtros.zona);
      return q;
    };
  }

  async function cargarDatos() {
    setCargando(true);
    setError('');
    try {
      const datos = await obtenerTodo(construirConsultaBase('v_pedidos_dashboard'));
      setFilas(datos);

      if (filtros.fechaInicio && filtros.fechaFin) {
        const inicioAnterior = unAnioAntes(filtros.fechaInicio);
        const finAnterior = unAnioAntes(filtros.fechaFin);
        let q = supabase.from('v_pedidos_dashboard').select('*');
        if (filtros.co) q = q.eq('co', filtros.co);
        else if (cosPermitidos) q = q.in('co', cosPermitidos.length ? cosPermitidos : ['__ninguno__']);
        q = q.gte('fecha_actualizacion', inicioAnterior).lte('fecha_actualizacion', finAnterior);
        const datosAnterior = await obtenerTodo(() => q);
        setFilasAnioAnterior(datosAnterior);
      } else {
        setFilasAnioAnterior([]);
      }
    } catch (e) {
      setError(e.message || 'Error cargando el dashboard.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (profile) cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, filtros]);

  const tarjetasResumen = useMemo(() => calcularTarjetasPedidos(filas), [filas]);

  const cuadroProveedor = useMemo(() => agruparValorFacturado(filas, 'proveedor', 'proveedor'), [filas]);
  const cuadroVendedor = useMemo(() => agruparValorFacturado(filas, 'nombre_vendedor', 'nombre_vendedor'), [filas]);
  const cuadroCliente = useMemo(() => agruparValorFacturado(filas, 'razon_social_cliente_despacho', 'razon_social_cliente_despacho'), [filas]);
  const cuadroResponsable = useMemo(() => agruparResponsableMotivo(filas, 'responsable_motivo', 'responsable'), [filas]);
  const cuadroMotivo = useMemo(() => agruparResponsableMotivo(filas, 'motivo_nombre', 'motivo'), [filas]);
  const cuadroItemPendiente = useMemo(() => agruparItemPendiente(filas), [filas]);

  const graficoCOActual = useMemo(() => calcularNsPorCO(filas), [filas]);
  const graficoCOAnterior = useMemo(() => calcularNsPorCO(filasAnioAnterior), [filasAnioAnterior]);
  const graficoComparativoCO = useMemo(() => {
    const cos = new Set([...graficoCOActual.map((g) => g.co), ...graficoCOAnterior.map((g) => g.co)]);
    return [...cos].sort().map((co) => ({
      co,
      periodo_actual: graficoCOActual.find((g) => g.co === co)?.ns_valor || 0,
      mismo_mes_anio_anterior: graficoCOAnterior.find((g) => g.co === co)?.ns_valor || 0,
    }));
  }, [graficoCOActual, graficoCOAnterior]);

  const graficoPorMes = useMemo(() => calcularNsPorMes(filas), [filas]);

  async function exportar() {
    setExportando(true);
    try {
      const datos = await obtenerTodo(construirConsultaBase('v_pedidos_dashboard'));
      const filasExportar = datos.map((f) => ({
        'C.O.': f.co,
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
        'Razon social cliente despacho': f.razon_social_cliente_despacho,
        'Nombre vendedor': f.nombre_vendedor,
        motivo: f.motivo_nombre,
        responsable: f.responsable_motivo,
        'clasificacion referencia': f.clasificacion_referencia,
        'clasificacion cliente': f.clasificacion_cliente,
      }));

      if (filasExportar.length > LIMITE_FILAS_EXCEL) {
        const csv = Papa.unparse(filasExportar);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dashboard_${filtros.fechaInicio || 'inicio'}_a_${filtros.fechaFin || 'hoy'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const hoja = XLSX.utils.json_to_sheet(filasExportar);
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, 'Dashboard');
        XLSX.writeFile(libro, `dashboard_${filtros.fechaInicio || 'inicio'}_a_${filtros.fechaFin || 'hoy'}.xlsx`);
      }
    } catch (e) {
      setError(e.message || 'Error exportando.');
    } finally {
      setExportando(false);
    }
  }

  async function actualizarClasificacion() {
    setRefrescando(true);
    const { error } = await supabase.rpc('refrescar_pareto');
    if (error) setError(`No se pudo actualizar la clasificación: ${error.message}`);
    setRefrescando(false);
    cargarDatos();
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="dashboard">
      <h2>Dashboard — Nivel de servicio de abastecimiento</h2>

      <div className="panel-dashboard panel-filtros">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label>C.O.</label><br />
            <select value={filtros.co} onChange={(e) => setFiltros({ ...filtros, co: e.target.value })}>
              <option value="">Todos</option>
              {cosDisponibles.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Desde</label><br />
            <input type="date" value={filtros.fechaInicio} onChange={(e) => setFiltros({ ...filtros, fechaInicio: e.target.value })} />
          </div>
          <div>
            <label>Hasta</label><br />
            <input type="date" value={filtros.fechaFin} onChange={(e) => setFiltros({ ...filtros, fechaFin: e.target.value })} />
          </div>
          <div>
            <label>Razón social sucursal despacho</label><br />
            <input value={filtros.razonSocialSucursal} onChange={(e) => setFiltros({ ...filtros, razonSocialSucursal: e.target.value })} />
          </div>
          <div>
            <label>Nombre vendedor</label><br />
            <input value={filtros.vendedor} onChange={(e) => setFiltros({ ...filtros, vendedor: e.target.value })} />
          </div>
          <div>
            <label>Proveedor</label><br />
            <input value={filtros.proveedor} onChange={(e) => setFiltros({ ...filtros, proveedor: e.target.value })} />
          </div>
          <div>
            <label>Descripción item</label><br />
            <input value={filtros.descItem} onChange={(e) => setFiltros({ ...filtros, descItem: e.target.value })} />
          </div>
          <div>
            <label>Canal</label><br />
            <select value={filtros.canal} onChange={(e) => setFiltros({ ...filtros, canal: e.target.value })}>
              <option value="">Todos</option>
              {canalesDisponibles.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Zona</label><br />
            <select value={filtros.zona} onChange={(e) => setFiltros({ ...filtros, zona: e.target.value })}>
              <option value="">Todas</option>
              {zonasDisponibles.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <button onClick={exportar} disabled={exportando}>{exportando ? 'Exportando...' : 'Exportar a Excel'}</button>
          <button onClick={actualizarClasificacion} disabled={refrescando} title="Vuelve a calcular la clasificación A/B/C/D con los datos más recientes">
            {refrescando ? 'Actualizando...' : 'Actualizar clasificación'}
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {cargando && <p className="indicador-actualizando">Actualizando...</p>}

      <ErrorBoundary>
        <TarjetasResumen tarjetas={tarjetasResumen} />
      </ErrorBoundary>

      <div className="rejilla-dashboard">
        <ErrorBoundary>
          <div className="panel-dashboard">
            <CuadroDashboard
              titulo="Cuadro 1: Detalle por proveedor"
              columnas={[
                { clave: 'proveedor', etiqueta: 'Proveedor' },
                { clave: 'valor_solicitado', etiqueta: 'Valor solicitado' },
                { clave: 'valor_facturado', etiqueta: 'Valor facturado' },
                { clave: 'ns_valor', etiqueta: 'NS Valor' },
                { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente' },
              ]}
              filas={cuadroProveedor}
              formateador={{ valor_solicitado: moneda, valor_facturado: moneda, ns_valor: porcentaje, porcentaje_pendiente: porcentaje }}
            />
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <CuadroDashboard
              titulo="Cuadro 2: Detalle por nombre de vendedor"
              columnas={[
                { clave: 'nombre_vendedor', etiqueta: 'Vendedor' },
                { clave: 'valor_solicitado', etiqueta: 'Valor solicitado' },
                { clave: 'valor_facturado', etiqueta: 'Valor facturado' },
                { clave: 'ns_valor', etiqueta: 'NS Valor' },
                { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente' },
              ]}
              filas={cuadroVendedor}
              formateador={{ valor_solicitado: moneda, valor_facturado: moneda, ns_valor: porcentaje, porcentaje_pendiente: porcentaje }}
            />
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <CuadroDashboard
              titulo="Cuadro 3: Detalle por razón social cliente despacho"
              columnas={[
                { clave: 'razon_social_cliente_despacho', etiqueta: 'Razón social cliente' },
                { clave: 'valor_solicitado', etiqueta: 'Valor solicitado' },
                { clave: 'valor_facturado', etiqueta: 'Valor facturado' },
                { clave: 'ns_valor', etiqueta: 'NS Valor' },
                { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente' },
              ]}
              filas={cuadroCliente}
              formateador={{ valor_solicitado: moneda, valor_facturado: moneda, ns_valor: porcentaje, porcentaje_pendiente: porcentaje }}
            />
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <CuadroDashboard
              titulo="Cuadro 4: Detalle por responsable"
              columnas={[
                { clave: 'responsable', etiqueta: 'Responsable' },
                { clave: 'valor', etiqueta: 'Valor' },
                { clave: 'cantidad_total', etiqueta: 'Cantidad total' },
                { clave: 'valor_pendiente', etiqueta: 'Valor del pendiente' },
              ]}
              filas={cuadroResponsable}
              formateador={{ valor: moneda, cantidad_total: moneda, valor_pendiente: moneda }}
            />
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <CuadroDashboard
              titulo="Cuadro 5: Detalle por motivo"
              columnas={[
                { clave: 'motivo', etiqueta: 'Motivo' },
                { clave: 'valor', etiqueta: 'Valor' },
                { clave: 'cantidad_total', etiqueta: 'Cantidad total' },
                { clave: 'valor_pendiente', etiqueta: 'Valor del pendiente' },
              ]}
              filas={cuadroMotivo}
              formateador={{ valor: moneda, cantidad_total: moneda, valor_pendiente: moneda }}
            />
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <CuadroDashboard
              titulo="Cuadro 6: Detalle por descripción de ítem con pendiente"
              columnas={[
                { clave: 'desc_item', etiqueta: 'Descripción ítem' },
                { clave: 'cantidad_pendiente', etiqueta: 'Cantidad pendiente' },
                { clave: 'valor_pendiente', etiqueta: 'Valor pendiente' },
              ]}
              filas={cuadroItemPendiente}
              formateador={{ cantidad_pendiente: moneda, valor_pendiente: moneda }}
            />
          </div>
        </ErrorBoundary>
      </div>

      <div className="rejilla-dashboard">
        <ErrorBoundary>
          <div className="panel-dashboard">
            <h3>Gráfico 1: NS Valor por C.O. — periodo seleccionado vs. mismo mes del año anterior</h3>
            {!filtros.fechaInicio || !filtros.fechaFin ? (
              <p style={{ opacity: 0.7 }}>Selecciona un rango de fechas para ver la comparación.</p>
            ) : graficoComparativoCO.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Sin datos para los filtros seleccionados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={graficoComparativoCO}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="co" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="periodo_actual" name="Periodo seleccionado" fill="#1565c0" />
                  <Bar dataKey="mismo_mes_anio_anterior" name="Mismo mes año anterior" fill="#90caf9" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <h3>Gráfico 2: NS Valor por mes</h3>
            {graficoPorMes.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Sin datos para los filtros seleccionados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={graficoPorMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip />
                  <Line type="monotone" dataKey="ns_valor" name="NS Valor" stroke="#1565c0" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ErrorBoundary>
      </div>
    </Layout>
  );
}
