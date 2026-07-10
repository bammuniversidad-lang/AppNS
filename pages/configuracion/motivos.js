import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { supabase } from '../../lib/supabaseClient';

export default function Motivos({ tema, alternarTema }) {
  const [motivos, setMotivos] = useState([]);
  const [nombre, setNombre] = useState('');
  const [responsable, setResponsable] = useState('');
  const [error, setError] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [edicion, setEdicion] = useState({ nombre: '', responsable: '' });

  async function cargar() {
    const { data } = await supabase.from('motivos').select('*').order('nombre');
    setMotivos(data || []);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function crear(e) {
    e.preventDefault();
    setError('');
    const { error } = await supabase.from('motivos').insert({ nombre, responsable });
    if (error) {
      setError(error.message);
      return;
    }
    setNombre('');
    setResponsable('');
    cargar();
  }

  function iniciarEdicion(m) {
    setEditandoId(m.id);
    setEdicion({ nombre: m.nombre, responsable: m.responsable });
  }

  async function guardarEdicion(id) {
    setError('');
    const { error } = await supabase
      .from('motivos')
      .update({ nombre: edicion.nombre, responsable: edicion.responsable })
      .eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditandoId(null);
    cargar();
  }

  return (
    <Layout tema={tema} alternarTema={alternarTema} requiereModulo="configuracion_motivos">
      <h2>Configuración de motivos</h2>

      <form onSubmit={crear} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <label>Motivo</label><br />
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div>
          <label>Responsable</label><br />
          <input required value={responsable} onChange={(e) => setResponsable(e.target.value)} />
        </div>
        <button type="submit">Agregar</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <table style={{ maxWidth: 600 }}>
        <thead>
          <tr><th>Motivo</th><th>Responsable</th><th></th></tr>
        </thead>
        <tbody>
          {motivos.map((m) => (
            <tr key={m.id}>
              {editandoId === m.id ? (
                <>
                  <td>
                    <input value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
                  </td>
                  <td>
                    <input value={edicion.responsable} onChange={(e) => setEdicion({ ...edicion, responsable: e.target.value })} />
                  </td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => guardarEdicion(m.id)}>Guardar</button>
                    <button onClick={() => setEditandoId(null)}>Cancelar</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{m.nombre}</td>
                  <td>{m.responsable}</td>
                  <td><button onClick={() => iniciarEdicion(m)}>Modificar</button></td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
