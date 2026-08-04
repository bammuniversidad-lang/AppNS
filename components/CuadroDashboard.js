import { useMemo, useState } from 'react';
import { ThOrdenable, useOrdenTabla } from './TablaHeader';

export default function CuadroDashboard({ titulo, columnas, filas, formateador, colorCelda, campoFiltro, valorSeleccionado, alSeleccionarFila }) {
  const [orden, setOrden] = useState(null);
  const [anchos, setAnchos] = useState({});
  const ordenarFilas = useOrdenTabla();

  function alOrdenar(clave) {
    setOrden((prev) => {
      if (prev?.clave === clave) return { clave, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' };
      return { clave, direccion: 'asc' };
    });
  }

  function alRedimensionar(clave, ancho) {
    setAnchos((prev) => ({ ...prev, [clave]: ancho }));
  }

  const filasOrdenadas = useMemo(() => ordenarFilas(filas, orden), [filas, orden]);
  const TOPE_IMPRESION = 15;

  return (
    <div style={{ marginBottom: 24 }}>
      <h3>{titulo}</h3>
      <div style={{ maxHeight: 380, overflow: 'auto' }} className="contenedor-cuadro-dashboard">
        <table>
          <thead>
            <tr>
              {columnas.map((c) => (
                <ThOrdenable
                  key={c.clave}
                  clave={c.clave}
                  etiqueta={c.etiqueta}
                  orden={orden}
                  alOrdenar={alOrdenar}
                  ancho={anchos[c.clave] || c.anchoInicial || 150}
                  alRedimensionar={alRedimensionar}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.length === 0 ? (
              <tr><td colSpan={columnas.length} style={{ textAlign: 'center', opacity: 0.7 }}>Sin datos para los filtros seleccionados</td></tr>
            ) : (
              filasOrdenadas.map((f, i) => {
                const valorFila = campoFiltro ? f[campoFiltro] : null;
                const activa = campoFiltro && valorSeleccionado === valorFila;
                return (
                  <tr
                    key={i}
                    onClick={alSeleccionarFila ? () => alSeleccionarFila(campoFiltro, valorFila) : undefined}
                    className={`${alSeleccionarFila ? 'fila-clicable' : ''} ${i >= TOPE_IMPRESION ? 'fila-oculta-al-imprimir' : ''}`}
                    style={activa ? { backgroundColor: '#bbdefb' } : undefined}
                  >
                    {columnas.map((c) => {
                      const ancho = anchos[c.clave] || c.anchoInicial || 150;
                      const claseColor = colorCelda?.[c.clave] ? colorCelda[c.clave](f[c.clave]) : '';
                      return (
                        <td
                          key={c.clave}
                          className={claseColor}
                          style={{ width: ancho, minWidth: ancho, maxWidth: ancho, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={String(f[c.clave] ?? '')}
                        >
                          {formateador?.[c.clave] ? formateador[c.clave](f[c.clave]) : f[c.clave]}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {filasOrdenadas.length > TOPE_IMPRESION && (
        <p className="nota-solo-impresion">
          Mostrando el top {TOPE_IMPRESION} de {filasOrdenadas.length} registros. Descarga el Excel para verlos todos.
        </p>
      )}
    </div>
  );
}

// Reglas de color estándar reutilizables (verde/amarillo/rojo metalizado)
export function colorPorNsValor(v) {
  const n = Number(v || 0) * 100;
  if (n >= 97) return 'celda-verde-metal';
  if (n >= 90) return 'celda-amarilla-metal';
  return 'celda-roja-metal';
}

export function colorPorPorcentajePendiente(v) {
  const n = Number(v || 0) * 100;
  if (n <= 3) return 'celda-verde-metal';
  if (n < 10) return 'celda-amarilla-metal';
  return 'celda-roja-metal';
}
