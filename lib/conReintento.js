// Reintento automático para consultas a Supabase que pueden fallar de forma
// transitoria (timeouts de Postgres, cortes de red) — típico en el plan
// gratuito de Supabase, donde el cómputo es compartido entre varios
// proyectos y el tiempo de respuesta de una misma consulta puede variar
// mucho de un momento a otro (ver Etapa 41/42 del README para el detalle
// del diagnóstico).
//
// Uso:
//   const { data, error } = await conReintento(() => supabase.rpc('dashboard_completo', parametros));
//
// Importante: hay que pasar una función que CREA la consulta (no la
// consulta ya ejecutada), porque cada reintento necesita volver a construir
// y disparar la petición desde cero.

const CODIGOS_TRANSITORIOS = new Set([
  '57014', // canceling statement due to statement timeout (Postgres)
  '08006', // connection failure
  '08003', // connection does not exist
  '08001', // unable to connect
  '53300', // too many connections
]);

function esErrorTransitorio(error) {
  if (!error) return false;
  if (CODIGOS_TRANSITORIOS.has(error.code)) return true;
  const mensaje = String(error.message || '').toLowerCase();
  return (
    mensaje.includes('timeout') ||
    mensaje.includes('fetch failed') ||
    mensaje.includes('failed to fetch') ||
    mensaje.includes('network') ||
    mensaje.includes('socket')
  );
}

/**
 * Ejecuta una consulta de Supabase (que llega como función para poder
 * repetirla) y, si falla con un error transitorio, reintenta con una
 * pequeña espera creciente antes de rendirse.
 *
 * @param {() => Promise<{data: any, error: any}>} crearConsulta
 * @param {{intentos?: number, esperaBaseMs?: number}} [opciones]
 * @returns {Promise<{data: any, error: any, reintentos?: number}>}
 */
export async function conReintento(crearConsulta, opciones = {}) {
  const { intentos = 3, esperaBaseMs = 1200 } = opciones;
  let resultado;
  for (let intento = 1; intento <= intentos; intento++) {
    resultado = await crearConsulta();
    if (!resultado?.error) {
      return intento > 1 ? { ...resultado, reintentos: intento - 1 } : resultado;
    }
    if (!esErrorTransitorio(resultado.error) || intento === intentos) {
      return resultado;
    }
    await new Promise((r) => setTimeout(r, esperaBaseMs * intento));
  }
  return resultado;
}

/**
 * Mensaje de error amigable: si el error es uno de los transitorios que ya
 * reintentamos y aun así no funcionó, se lo decimos al usuario con una
 * sugerencia útil en vez del mensaje técnico de Postgres.
 */
export function mensajeErrorAmigable(error, contexto = '') {
  if (!error) return '';
  const prefijo = contexto ? `${contexto}: ` : '';
  if (esErrorTransitorio(error)) {
    return `${prefijo}El servidor tardó más de lo normal y no respondió a tiempo (puede pasar en horas de mucho uso). Ya se reintentó automáticamente; prueba darle "Actualizar" de nuevo en un momento.`;
  }
  return `${prefijo}${error.message || 'Error desconocido.'}`;
}
