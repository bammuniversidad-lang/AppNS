import { useMemo, useState } from 'react';
import { ThOrdenable, useOrdenTabla } from './TablaHeader';

export default function CuadroDashboard({ titulo, columnas, filas, formateador }) {
  const [orden, setOrden] = useState(null);
  const ordenarFilas = useOrdenTabla();

  function alOrdenar(clave) {
    setOrden((prev) => {
      if (prev?.clave === clave) return { clave, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' };
      return { clave, direccion: 'asc' };
    });
  }

  const filasOrdenadas = useMemo(() => ordenarFilas(filas, orden), [filas, orden]);

  return (
    <div style={{ marginBottom: 24 }}>
      <h3>{titulo}</h3>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              {columnas.map((c) => (
                <ThOrdenable key={c.clave} clave={c.clave} etiqueta={c.etiqueta} orden={orden} alOrdenar={alOrdenar} />
              ))}
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.length === 0 ? (
              <tr><td colSpan={columnas.length} style={{ textAlign: 'center', opacity: 0.7 }}>Sin datos para los filtros seleccionados</td></tr>
            ) : (
              filasOrdenadas.map((f, i) => (
                <tr key={i}>
                  {columnas.map((c) => (
                    <td key={c.clave}>{formateador?.[c.clave] ? formateador[c.clave](f[c.clave]) : f[c.clave]}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
