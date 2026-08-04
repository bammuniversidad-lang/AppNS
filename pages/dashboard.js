import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, LabelList,
  PieChart, Pie, Cell, ComposedChart, Area, ReferenceArea, ReferenceLine,
} from 'recharts';
import Layout from '../components/Layout';
import CuadroDashboard, { colorPorNsValor, colorPorPorcentajePendiente } from '../components/CuadroDashboard';
import TarjetasResumen from '../components/Tarjetas';
import ErrorBoundary from '../components/ErrorBoundary';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { primerDiaMesActual, hoyISO } from '../lib/fechas';
import { exportarDashboardExcel, exportarDashboardPowerPoint } from '../lib/exportarDashboard';


const moneda = (v) => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
const porcentaje = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;
const etiquetaPorcentaje = (v) => `${Number(v || 0).toFixed(1)}%`;

const ETIQUETAS_CAMPO = {
  proveedor: 'Proveedor',
  nombre_vendedor: 'Vendedor',
  razon_social_cliente_despacho: 'Cliente',
  responsable_motivo: 'Responsable',
  motivo_nombre: 'Motivo',
  desc_item: 'Ítem',
  co: 'C.O.',
  dia: 'Día',
  clasificacion_referencia: 'Clasificación',
};

const PALETA_ANILLO = ['#1565c0', '#26a69a', '#ef6c00', '#8e24aa', '#c62828', '#00838f', '#9e9d24', '#6d4c41', '#5c6bc0', '#00695c'];

function soloNumeroDia(fechaISO) {
  if (!fechaISO) return '';
  const partes = String(fechaISO).split('-');
  return String(Number(partes[2]));
}

// Etiqueta grande para cada zona de la curva de Pareto (letra + cantidad + %),
// centrada en medio del gráfico y con fondo para que se lea bien.
function EtiquetaZonaPareto({ viewBox, letra, color, resumen }) {
  if (!viewBox || viewBox.width < 30) return null;
  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y + viewBox.height / 2;
  const texto2 = resumen ? `${resumen.cantidad} ref. · ${resumen.porcentaje.toFixed(1)}%` : '';
  const ancho = Math.max(64, texto2.length * 6.2 + 16);
  return (
    <g>
      <rect x={cx - ancho / 2} y={cy - 24} width={ancho} height={42} rx={6} fill="rgba(20,20,20,0.75)" stroke={color} strokeWidth={1.5} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={19} fontWeight="bold" fill={color}>{letra}</text>
      {resumen && (
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={11} fontWeight="600" fill="#ffffff">{texto2}</text>
      )}
    </g>
  );
}
function EtiquetaConFondo({ x, y, value, formatter }) {
  if (value === undefined || value === null || Number(value) === 0) return null;
  const texto = formatter ? formatter(value) : String(value);
  const ancho = Math.max(32, texto.length * 7);
  return (
    <g>
      <rect x={x - ancho / 2} y={y - 22} width={ancho} height={18} rx={3} fill="#bbdefb" stroke="#64b5f6" strokeWidth={0.5} />
      <text x={x} y={y - 9} textAnchor="middle" fontSize={11} fontWeight="600" fill="#0d3c73">{texto}</text>
    </g>
  );
}

export default function Dashboard({ tema, alternarTema }) {
  const { profile } = useAuth();
  const [filtros, setFiltros] = useState({
    co: '', fechaInicio: primerDiaMesActual(), fechaFin: hoyISO(), razonSocialSucursal: '', vendedor: '', proveedor: '', descItem: '', canal: '', zona: '',
  });
  const [seleccionCruzada, setSeleccionCruzada] = useState(null);
  const [cosDisponibles, setCosDisponibles] = useState([]);
  const [canalesDisponibles, setCanalesDisponibles] = useState([]);
  const [zonasDisponibles, setZonasDisponibles] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [exportandoPPT, setExportandoPPT] = useState(false);
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

  const co_list = filtros.co ? [filtros.co] : (cosPermitidos && cosPermitidos.length ? cosPermitidos : null);

  const parametrosRpc = {
    p_fecha_inicio: filtros.fechaInicio || null,
    p_fecha_fin: filtros.fechaFin || null,
    p_co_list: co_list,
    p_razon_social_sucursal: filtros.razonSocialSucursal || null,
    p_vendedor: filtros.vendedor || null,
    p_proveedor: filtros.proveedor || null,
    p_desc_item: filtros.descItem || null,
    p_canal: filtros.canal || null,
    p_zona: filtros.zona || null,
    p_cross_campo: seleccionCruzada?.campo || null,
    p_cross_valor: seleccionCruzada?.valor != null ? String(seleccionCruzada.valor) : null,
  };

  async function cargarDatos() {
    setCargando(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('dashboard_completo', parametrosRpc);
      if (error) throw error;
      setDatos(data);
    } catch (e) {
      setError(e.message || 'Error cargando el dashboard.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (profile) cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, filtros, seleccionCruzada]);

  function alSeleccionarFila(campo, valor) {
    setSeleccionCruzada((prev) => (prev && prev.campo === campo && prev.valor === valor ? null : { campo, valor }));
  }

  const tarjetas = datos?.tarjetas || null;
  const cuadros = datos ? {
    por_proveedor: datos.por_proveedor || [],
    por_vendedor: datos.por_vendedor || [],
    por_cliente: datos.por_cliente || [],
    por_responsable: datos.por_responsable || [],
    por_motivo: datos.por_motivo || [],
    por_item_pendiente: datos.por_item_pendiente || [],
    por_motivo_item: datos.por_motivo_item || [],
    por_clasificacion_referencia: datos.por_clasificacion_referencia || [],
  } : null;
  const graficoCO = datos?.grafico_co || [];
  const graficoDia = datos?.grafico_dia || [];
  const curvaPareto = datos?.curva_pareto || null;
  const resumenPorClase = useMemo(() => {
    const filas = cuadros?.por_clasificacion_referencia || [];
    const total = filas.reduce((s, f) => s + Number(f.valor_solicitado || 0), 0);
    const mapa = {};
    filas.forEach((f) => {
      mapa[f.clasificacion] = {
        cantidad: f.cantidad_referencias,
        porcentaje: total > 0 ? (Number(f.valor_solicitado) / total) * 100 : 0,
      };
    });
    return mapa;
  }, [cuadros]);
  const donutResponsable = useMemo(
    () => (cuadros?.por_responsable || [])
      .filter((r) => Number(r.valor_pendiente) > 0)
      .map((r) => ({ name: r.responsable, value: Math.round(r.valor_pendiente) })),
    [cuadros]
  );

  function resumenFiltrosTexto() {
    const partes = [];
    partes.push(`Del ${filtros.fechaInicio || '(sin límite)'} al ${filtros.fechaFin || '(sin límite)'}`);
    if (filtros.co) partes.push(`C.O. ${filtros.co}`);
    if (filtros.proveedor) partes.push(`Proveedor: ${filtros.proveedor}`);
    if (filtros.vendedor) partes.push(`Vendedor: ${filtros.vendedor}`);
    if (filtros.canal) partes.push(`Canal: ${filtros.canal}`);
    if (filtros.zona) partes.push(`Zona: ${filtros.zona}`);
    if (seleccionCruzada) partes.push(`${ETIQUETAS_CAMPO[seleccionCruzada.campo] || seleccionCruzada.campo}: ${seleccionCruzada.valor}`);
    return partes.join('  •  ');
  }

  async function exportarExcel() {
    setExportando(true);
    try {
      // Usa los cuadros que ya están calculados en pantalla (no vuelve a
      // traer todas las filas de pedidos, por eso es casi instantáneo).
      await exportarDashboardExcel({
        tarjetas,
        cuadros,
        nombreArchivo: `dashboard_${filtros.fechaInicio || 'inicio'}_a_${filtros.fechaFin || 'hoy'}.xlsx`,
      });
    } catch (e) {
      setError(e.message || 'Error exportando a Excel.');
    } finally {
      setExportando(false);
    }
  }

  async function exportarPPT() {
    setExportandoPPT(true);
    try {
      await exportarDashboardPowerPoint({
        tarjetas,
        cuadros,
        graficos: { graficoCO, graficoDia },
        resumenFiltros: resumenFiltrosTexto(),
        nombreArchivo: `dashboard_${filtros.fechaInicio || 'inicio'}_a_${filtros.fechaFin || 'hoy'}.pptx`,
      });
    } catch (e) {
      setError(e.message || 'Error exportando a PowerPoint.');
    } finally {
      setExportandoPPT(false);
    }
  }

  function exportarPDF() {
    window.print();
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="dashboard">
      <h2>Dashboard — Nivel de servicio de abastecimiento</h2>

      <div className="panel-dashboard panel-filtros no-imprimir">
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
          <button onClick={exportarExcel} disabled={exportando || !datos}>{exportando ? 'Exportando...' : 'Exportar a Excel'}</button>
          <button onClick={exportarPPT} disabled={exportandoPPT || !datos}>{exportandoPPT ? 'Exportando...' : 'Exportar a PowerPoint'}</button>
          <button onClick={exportarPDF}>Exportar a PDF</button>
          <button onClick={cargarDatos} disabled={cargando} title="Vuelve a consultar el Dashboard con los datos más recientes">
            {cargando ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {seleccionCruzada && (
        <div className="chip-filtro-activo no-imprimir">
          Filtrando por {ETIQUETAS_CAMPO[seleccionCruzada.campo] || seleccionCruzada.campo}: {String(seleccionCruzada.valor)}
          <button onClick={() => setSeleccionCruzada(null)}>✕</button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {cargando && <p className="indicador-actualizando">Actualizando...</p>}

      <ErrorBoundary>
        <TarjetasResumen tarjetas={tarjetas} />
      </ErrorBoundary>

      {cuadros && (
        <div className="rejilla-dashboard">
          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 1: Detalle por proveedor"
                columnas={[
                  { clave: 'proveedor', etiqueta: 'Proveedor', anchoInicial: 220 },
                  { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
                  { clave: 'valor_facturado', etiqueta: 'Valor facturado', anchoInicial: 140 },
                  { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
                  { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', anchoInicial: 110 },
                ]}
                filas={cuadros.por_proveedor}
                formateador={{ valor_solicitado: moneda, valor_facturado: moneda, ns_valor: porcentaje, porcentaje_pendiente: porcentaje }}
                colorCelda={{ ns_valor: colorPorNsValor, porcentaje_pendiente: colorPorPorcentajePendiente }}
                campoFiltro="proveedor"
                valorSeleccionado={seleccionCruzada?.campo === 'proveedor' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={alSeleccionarFila}
              />
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 2: Detalle por nombre de vendedor"
                columnas={[
                  { clave: 'nombre_vendedor', etiqueta: 'Vendedor', anchoInicial: 220 },
                  { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
                  { clave: 'valor_facturado', etiqueta: 'Valor facturado', anchoInicial: 140 },
                  { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
                  { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', anchoInicial: 110 },
                ]}
                filas={cuadros.por_vendedor}
                formateador={{ valor_solicitado: moneda, valor_facturado: moneda, ns_valor: porcentaje, porcentaje_pendiente: porcentaje }}
                colorCelda={{ ns_valor: colorPorNsValor, porcentaje_pendiente: colorPorPorcentajePendiente }}
                campoFiltro="nombre_vendedor"
                valorSeleccionado={seleccionCruzada?.campo === 'nombre_vendedor' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={alSeleccionarFila}
              />
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 3: Detalle por razón social cliente despacho"
                columnas={[
                  { clave: 'razon_social_cliente_despacho', etiqueta: 'Razón social cliente', anchoInicial: 240 },
                  { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 140 },
                  { clave: 'valor_facturado', etiqueta: 'Valor facturado', anchoInicial: 140 },
                  { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
                  { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', anchoInicial: 110 },
                ]}
                filas={cuadros.por_cliente}
                formateador={{ valor_solicitado: moneda, valor_facturado: moneda, ns_valor: porcentaje, porcentaje_pendiente: porcentaje }}
                colorCelda={{ ns_valor: colorPorNsValor, porcentaje_pendiente: colorPorPorcentajePendiente }}
                campoFiltro="razon_social_cliente_despacho"
                valorSeleccionado={seleccionCruzada?.campo === 'razon_social_cliente_despacho' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={alSeleccionarFila}
              />
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 4: Detalle por responsable"
                columnas={[
                  { clave: 'responsable', etiqueta: 'Responsable', anchoInicial: 220 },
                  { clave: 'valor', etiqueta: 'Valor', anchoInicial: 140 },
                  { clave: 'cantidad_total', etiqueta: 'Cantidad total', anchoInicial: 140 },
                  { clave: 'valor_pendiente', etiqueta: 'Valor del pendiente', anchoInicial: 150 },
                ]}
                filas={cuadros.por_responsable}
                formateador={{ valor: moneda, cantidad_total: moneda, valor_pendiente: moneda }}
                campoFiltro="responsable"
                valorSeleccionado={seleccionCruzada?.campo === 'responsable_motivo' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={(_campo, valor) => alSeleccionarFila('responsable_motivo', valor)}
              />
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 5: Detalle por motivo"
                columnas={[
                  { clave: 'motivo', etiqueta: 'Motivo', anchoInicial: 220 },
                  { clave: 'valor', etiqueta: 'Valor', anchoInicial: 140 },
                  { clave: 'cantidad_total', etiqueta: 'Cantidad total', anchoInicial: 140 },
                  { clave: 'valor_pendiente', etiqueta: 'Valor del pendiente', anchoInicial: 150 },
                ]}
                filas={cuadros.por_motivo}
                formateador={{ valor: moneda, cantidad_total: moneda, valor_pendiente: moneda }}
                campoFiltro="motivo"
                valorSeleccionado={seleccionCruzada?.campo === 'motivo_nombre' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={(_campo, valor) => alSeleccionarFila('motivo_nombre', valor)}
              />
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 6: Detalle por descripción de ítem con pendiente"
                columnas={[
                  { clave: 'desc_item', etiqueta: 'Descripción ítem', anchoInicial: 260 },
                  { clave: 'cantidad_pendiente', etiqueta: 'Cantidad pendiente', anchoInicial: 150 },
                  { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 150 },
                ]}
                filas={cuadros.por_item_pendiente}
                formateador={{ cantidad_pendiente: moneda, valor_pendiente: moneda }}
                campoFiltro="desc_item"
                valorSeleccionado={seleccionCruzada?.campo === 'desc_item' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={alSeleccionarFila}
              />
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 7: Detalle por motivo e ítem"
                columnas={[
                  { clave: 'motivo', etiqueta: 'Motivo', anchoInicial: 200 },
                  { clave: 'desc_item', etiqueta: 'Descripción ítem', anchoInicial: 240 },
                  { clave: 'cantidad_pendiente', etiqueta: 'Cantidad pendiente', anchoInicial: 150 },
                  { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 150 },
                ]}
                filas={cuadros.por_motivo_item}
                formateador={{ cantidad_pendiente: moneda, valor_pendiente: moneda }}
                campoFiltro="motivo"
                valorSeleccionado={seleccionCruzada?.campo === 'motivo_nombre' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={(_campo, valor) => alSeleccionarFila('motivo_nombre', valor)}
              />
            </div>
          </ErrorBoundary>

          <ErrorBoundary>
            <div className="panel-dashboard">
              <CuadroDashboard
                titulo="Cuadro 8: Detalle por clasificación de referencia (A/B/C/D)"
                columnas={[
                  { clave: 'clasificacion', etiqueta: 'Clasificación', anchoInicial: 110 },
                  { clave: 'cantidad_referencias', etiqueta: 'Cant. referencias', anchoInicial: 140 },
                  { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', anchoInicial: 150 },
                  { clave: 'valor_facturado', etiqueta: 'Valor facturado (remisionado)', anchoInicial: 170 },
                  { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', anchoInicial: 150 },
                  { clave: 'ns_valor', etiqueta: 'NS Valor', anchoInicial: 100 },
                  { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', anchoInicial: 110 },
                ]}
                filas={cuadros.por_clasificacion_referencia}
                formateador={{
                  cantidad_referencias: moneda, valor_solicitado: moneda, valor_facturado: moneda,
                  valor_pendiente: moneda, ns_valor: porcentaje, porcentaje_pendiente: porcentaje,
                }}
                colorCelda={{ ns_valor: colorPorNsValor, porcentaje_pendiente: colorPorPorcentajePendiente }}
                campoFiltro="clasificacion"
                valorSeleccionado={seleccionCruzada?.campo === 'clasificacion_referencia' ? seleccionCruzada.valor : undefined}
                alSeleccionarFila={(_campo, valor) => alSeleccionarFila('clasificacion_referencia', valor)}
              />
            </div>
          </ErrorBoundary>
        </div>
      )}

      <div className="rejilla-dashboard">
        <ErrorBoundary>
          <div className="panel-dashboard">
            <h3>Gráfico 1: NS Valor por C.O. — periodo seleccionado</h3>
            {graficoCO.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Sin datos para los filtros seleccionados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={graficoCO} barGap={4} margin={{ top: 24 }}>
                  <defs>
                    <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1e88e5" stopOpacity={1} />
                      <stop offset="100%" stopColor="#0d47a1" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="co" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 110]} ticks={[0,25,50,75,100]} />
                  <Tooltip contentStyle={{ fontSize: 12, backgroundColor: '#1c1c1c', border: '1px solid #444', borderRadius: 6, color: '#fff' }} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                  <Bar
                    dataKey="periodo_actual" name="Periodo seleccionado" fill="url(#gradActual)" radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(d) => alSeleccionarFila('co', d.co)}
                  >
                    <LabelList dataKey="periodo_actual" content={(p) => <EtiquetaConFondo {...p} formatter={etiquetaPorcentaje} />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <h3>Gráfico 2: NS Total día a día (rango seleccionado)</h3>
            {graficoDia.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Sin datos para los filtros seleccionados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={graficoDia} margin={{ top: 20 }}>
                  <XAxis dataKey="dia" tick={{ fontSize: 10 }} tickFormatter={soloNumeroDia} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 110]} ticks={[0,25,50,75,100]} />
                  <Tooltip contentStyle={{ fontSize: 12, backgroundColor: '#1c1c1c', border: '1px solid #444', borderRadius: 6, color: '#fff' }} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} labelFormatter={(v) => v} />
                  <Line
                    type="linear" dataKey="ns_total" name="NS Total" stroke="#26a69a" strokeWidth={3}
                    dot={{ r: 3, cursor: 'pointer' }}
                    activeDot={{
                      r: 5,
                      onClick: (...args) => {
                        const conPayload = args.find((a) => a && a.payload && a.payload.dia);
                        const dia = conPayload?.payload?.dia;
                        if (dia) setFiltros((f) => ({ ...f, fechaInicio: dia, fechaFin: dia }));
                      },
                    }}
                  >
                    <LabelList dataKey="ns_total" content={(p) => <EtiquetaConFondo {...p} formatter={etiquetaPorcentaje} />} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ErrorBoundary>
      </div>

      <div className="rejilla-dashboard">
        <ErrorBoundary>
          <div className="panel-dashboard">
            <h3>Gráfico 3: Valor pendiente por responsable</h3>
            {donutResponsable.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Sin datos para los filtros seleccionados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Tooltip
                    contentStyle={{ fontSize: 12, backgroundColor: '#1c1c1c', border: '1px solid #444', borderRadius: 6, color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(v) => moneda(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Pie
                    data={donutResponsable}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="45%"
                    outerRadius="75%"
                    paddingAngle={2}
                    cursor="pointer"
                    onClick={(d) => alSeleccionarFila('responsable_motivo', d.name)}
                    label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                  >
                    {donutResponsable.map((entrada, i) => (
                      <Cell
                        key={entrada.name}
                        fill={PALETA_ANILLO[i % PALETA_ANILLO.length]}
                        stroke={seleccionCruzada?.campo === 'responsable_motivo' && seleccionCruzada.valor === entrada.name ? '#fff' : 'none'}
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div className="panel-dashboard">
            <h3>Gráfico 4: Curva de Pareto — % de productos vs. % de ventas</h3>
            {!curvaPareto || curvaPareto.puntos.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Sin datos para los filtros seleccionados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={curvaPareto.puntos} margin={{ top: 40, right: 10 }}>
                  <defs>
                    <linearGradient id="zonaVerde" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#66bb6a" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#1b5e20" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="zonaAmarilla" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffee58" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#f9a825" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="zonaNaranja" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffa726" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#e65100" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="zonaRoja" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef5350" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#b71c1c" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="pct_items" type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <YAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, backgroundColor: '#1c1c1c', border: '1px solid #444', borderRadius: 6, color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(v, n) => [`${v}%`, n]}
                    labelFormatter={(v) => `${v}% de productos`}
                  />
                  {curvaPareto.x_a != null && (
                    <ReferenceArea
                      x1={0} x2={curvaPareto.x_a} y1={0} y2={100} fill="url(#zonaVerde)" stroke="#2e7d32"
                      label={(props) => <EtiquetaZonaPareto {...props} letra="A" color="#66bb6a" resumen={resumenPorClase.A} />}
                    />
                  )}
                  {curvaPareto.x_a != null && curvaPareto.x_b != null && (
                    <ReferenceArea
                      x1={curvaPareto.x_a} x2={curvaPareto.x_b} y1={0} y2={100} fill="url(#zonaAmarilla)" stroke="#f9a825"
                      label={(props) => <EtiquetaZonaPareto {...props} letra="B" color="#ffd54f" resumen={resumenPorClase.B} />}
                    />
                  )}
                  {curvaPareto.x_b != null && curvaPareto.x_c != null && (
                    <ReferenceArea
                      x1={curvaPareto.x_b} x2={curvaPareto.x_c} y1={0} y2={100} fill="url(#zonaNaranja)" stroke="#e65100"
                      label={(props) => <EtiquetaZonaPareto {...props} letra="C" color="#ffa726" resumen={resumenPorClase.C} />}
                    />
                  )}
                  {curvaPareto.x_c != null && (
                    <ReferenceArea
                      x1={curvaPareto.x_c} x2={100} y1={0} y2={100} fill="url(#zonaRoja)" stroke="#b71c1c"
                      label={(props) => <EtiquetaZonaPareto {...props} letra="D" color="#ef5350" resumen={resumenPorClase.D} />}
                    />
                  )}
                  <ReferenceLine y={80} stroke="#999" strokeDasharray="3 3" />
                  <ReferenceLine y={95} stroke="#999" strokeDasharray="3 3" />
                  <ReferenceLine y={99} stroke="#999" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="pct_valor" name="% de ventas" stroke="#0d3c73" fill="#64b5f6" fillOpacity={0.25} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </ErrorBoundary>
      </div>
    </Layout>
  );
}
