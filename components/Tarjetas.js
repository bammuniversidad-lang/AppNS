// Barra horizontal que cambia de color y de tamaño según el porcentaje:
// > 96% verde, 90%-96% amarillo, < 90% rojo.
export function BarraNivel({ valor }) {
  const pct = Math.max(0, Math.min(1, valor || 0)) * 100;
  let color = '#e53935'; // rojo
  if (pct > 96) color = '#43a047'; // verde
  else if (pct >= 90) color = '#fdd835'; // amarillo

  return (
    <div className="barra-nivel-fondo">
      <div className="barra-nivel-relleno" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

const TARJETAS_CONFIG = [
  {
    titulo: 'Pedidos',
    filas: [
      { etiqueta: 'Totales', clave: 'pedidos_totales', tipo: 'numero' },
      { etiqueta: 'Con pendientes', clave: 'pedidos_con_pendientes', tipo: 'numero' },
      { etiqueta: 'NS Pedidos', clave: 'ns_pedidos', tipo: 'porcentaje' },
    ],
    claveNivel: 'ns_pedidos',
  },
  {
    titulo: 'Líneas',
    filas: [
      { etiqueta: 'Totales', clave: 'lineas_totales', tipo: 'numero' },
      { etiqueta: 'Pendientes', clave: 'lineas_pendientes', tipo: 'numero' },
      { etiqueta: 'NS Líneas', clave: 'ns_lineas', tipo: 'porcentaje' },
    ],
    claveNivel: 'ns_lineas',
  },
  {
    titulo: 'Cantidad',
    filas: [
      { etiqueta: 'Total', clave: 'cantidad_total', tipo: 'entero' },
      { etiqueta: 'Pendiente', clave: 'cantidad_pendiente', tipo: 'entero' },
      { etiqueta: 'NS Cantidad', clave: 'ns_cantidad', tipo: 'porcentaje' },
    ],
    claveNivel: 'ns_cantidad',
  },
  {
    titulo: 'Valor',
    filas: [
      { etiqueta: 'Total', clave: 'valor_total', tipo: 'entero' },
      { etiqueta: 'Pendiente', clave: 'valor_pendiente', tipo: 'entero' },
      { etiqueta: 'NS Valor', clave: 'ns_valor', tipo: 'porcentaje' },
    ],
    claveNivel: 'ns_valor',
  },
  {
    titulo: 'NS Total',
    formula: '(Valor + Cantidad + Líneas) × 30% + Pedidos × 10%',
    claveValor: 'ns_total',
    claveNivel: 'ns_total',
  },
];

function formatearValor(valor, tipo) {
  if (valor === null || valor === undefined) return '-';
  if (tipo === 'porcentaje') return `${(Number(valor) * 100).toFixed(1)}%`;
  if (tipo === 'entero') return Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  return Number(valor).toLocaleString('es-CO');
}

// Las 5 tarjetas (Pedidos, Líneas, Cantidad, Valor, NS Total). Se usan en Pendientes y en el Dashboard.
export default function TarjetasResumen({ tarjetas }) {
  if (!tarjetas) return null;
  return (
    <div className="tarjetas">
      {TARJETAS_CONFIG.map((cfg) => (
        <div className="tarjeta" key={cfg.titulo}>
          <h3>{cfg.titulo}</h3>

          {cfg.claveValor ? (
            <>
              <p className="formula-tarjeta">{cfg.formula}</p>
              <div className="valor-grande-tarjeta">{formatearValor(tarjetas[cfg.claveValor], 'porcentaje')}</div>
            </>
          ) : (
            cfg.filas.map((f) => (
              <div className="fila" key={f.clave}>
                <span>{f.etiqueta}</span>
                <b>{formatearValor(tarjetas[f.clave], f.tipo)}</b>
              </div>
            ))
          )}

          <BarraNivel valor={tarjetas[cfg.claveNivel]} />
        </div>
      ))}
    </div>
  );
}
