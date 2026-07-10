import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { supabase } from '../../lib/supabaseClient';

export default function ConfiguracionCO({ tema, alternarTema }) {
  const [cos, setCos] = useState([]);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');

  async function cargar() {
    const { data } = await supabase.from('cos').select('*').order('codigo');
    setCos(data || []);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function crear(e) {
    e.preventDefault();
    setError('');
    const { error } = await supabase.from('cos').insert({ codigo, nombre });
    if (error) {
      setError(error.message);
      return;
    }
    setCodigo('');
    setNombre('');
    cargar();
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_co">
      <h2>Configuración de C.O.</h2>
      <p style={{ opacity: 0.8 }}>
        Los C.O. creados aquí quedan disponibles de inmediato para asignar a los usuarios,
        incluso antes de importar pedidos de ese C.O.
      </p>

      <form onSubmit={crear} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <label>Código C.O.</label><br />
          <input required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </div>
        <div>
          <label>Nombre / descripción (opcional)</label><br />
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <table style={{ maxWidth: 500 }}>
        <thead>
          <tr><th>Código</th><th>Nombre</th></tr>
        </thead>
        <tbody>
          {cos.map((c) => (
            <tr key={c.id}>
              <td>{c.codigo}</td>
              <td>{c.nombre}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
