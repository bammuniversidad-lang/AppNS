import * as XLSX from 'xlsx';
import Papa from 'papaparse';

// Quita tildes, puntuación y espacios extra para poder comparar encabezados
// sin importar cómo vengan escritos en el archivo origen.
export function normalizarEncabezado(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Mapeo encabezado normalizado -> columna en la base de datos "pedidos"
export const MAPEO_PEDIDOS = {
  co: 'co',
  fecha: 'fecha',
  fechaactualizacion: 'fecha_actualizacion',
  nrodocumento: 'nro_documento',
  bodega: 'bodega',
  proveedor: 'proveedor',
  referencia: 'referencia',
  descitem: 'desc_item',
  cantpedida: 'cant_pedida',
  cantremision: 'cant_remision',
  cantpendiente: 'cant_pendiente',
  valorsubtotal: 'valor_subtotal',
  clientefactura: 'cliente_factura',
  razonsocialclientedespacho: 'razon_social_cliente_despacho',
  nombrevendedor: 'nombre_vendedor',
  canal: 'canal',
  sucursaldespacho: 'sucursal_despacho',
  motivo: '_motivo_nombre',
  responsable: 'responsable_motivo',
};

const CAMPOS_NUMERICOS = ['cant_pedida', 'cant_remision', 'cant_pendiente', 'valor_subtotal'];
const CAMPOS_FECHA = ['fecha', 'fecha_actualizacion'];

function excelFechaAISO(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  // Fechas seriales de Excel
  if (typeof valor === 'number') {
    const fecha = XLSX.SSF.parse_date_code(valor);
    if (!fecha) return null;
    const mm = String(fecha.m).padStart(2, '0');
    const dd = String(fecha.d).padStart(2, '0');
    return `${fecha.y}-${mm}-${dd}`;
  }
  const texto = String(valor).trim();
  // dd/mm/yyyy o dd-mm-yyyy
  const m = texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // yyyy-mm-dd ya viene bien
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  return texto;
}

// Lee un File (xlsx/xls/csv) y devuelve un arreglo de objetos {encabezadoOriginal: valor}
export async function leerArchivo(file) {
  const nombre = file.name.toLowerCase();
  if (nombre.endsWith('.csv')) {
    const texto = await file.text();
    const resultado = Papa.parse(texto, { header: true, skipEmptyLines: true });
    if (resultado.errors && resultado.errors.length > 0) {
      throw new Error(`Error leyendo CSV: ${resultado.errors[0].message}`);
    }
    return resultado.data;
  }
  const buffer = await file.arrayBuffer();
  const libro = XLSX.read(buffer, { type: 'array', cellDates: false });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils.sheet_to_json(hoja, { defval: null, raw: true });
}

// Convierte filas crudas (con encabezados originales) a filas de "pedidos"
// listas para insertar, usando el mapeo de encabezados.
export function mapearFilasPedidos(filasCrudas) {
  const filas = [];
  const erroresFilas = [];

  filasCrudas.forEach((filaCruda, indice) => {
    const fila = {};
    for (const [encabezadoOriginal, valor] of Object.entries(filaCruda)) {
      const clave = MAPEO_PEDIDOS[normalizarEncabezado(encabezadoOriginal)];
      if (clave) fila[clave] = valor;
    }

    // Validación mínima de campos obligatorios
    const faltantes = ['co', 'nro_documento', 'bodega', 'referencia'].filter((c) => !fila[c] && fila[c] !== 0);
    if (faltantes.length > 0) {
      erroresFilas.push({
        fila: indice + 2, // +2 = encabezado + índice base 1
        error: `Faltan campos obligatorios: ${faltantes.join(', ')}`,
        // Se guarda lo que sí venía en la línea (aunque esté incompleta),
        // para que en el Excel de omitidos se pueda identificar cuál era.
        co: fila.co ?? '', nro_documento: fila.nro_documento ?? '', bodega: fila.bodega ?? '',
        referencia: fila.referencia ?? '', desc_item: fila.desc_item ?? '',
      });
      return;
    }

    for (const campo of CAMPOS_NUMERICOS) {
      if (fila[campo] !== undefined && fila[campo] !== null && fila[campo] !== '') {
        const num = Number(String(fila[campo]).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
        fila[campo] = isNaN(num) ? 0 : num;
      } else {
        fila[campo] = 0;
      }
    }

    for (const campo of CAMPOS_FECHA) {
      fila[campo] = excelFechaAISO(fila[campo]);
    }

    // normalizar claves de texto para que la validación de duplicados sea confiable
    fila.co = String(fila.co).trim();
    fila.nro_documento = String(fila.nro_documento).trim();
    fila.bodega = String(fila.bodega).trim();
    fila.referencia = String(fila.referencia).trim();

    filas.push(fila);
  });

  return { filas, erroresFilas };
}

// Mapeo encabezado normalizado -> columna en la base de datos "clientes"
export const MAPEO_CLIENTES = {
  cofactura: 'co_factura',
  codigo: 'codigo',
  estado: 'estado',
  razonsocial: 'razon_social',
  sucursal: 'sucursal',
  razonsocialsucursal: 'razon_social_sucursal',
  nombreestablecimiento: 'nombre_establecimiento',
  direccion1: 'direccion_1',
  direccion2: 'direccion_2',
  deptoestado: 'depto_estado',
  ciudad: 'ciudad',
  descbarrio: 'desc_barrio',
  canal: 'canal',
  centrocomercial: 'centro_comercial',
  zona: 'zona',
  bogota: 'bogota',
  unmovtofactura: 'un_movto_factura',
};

export function mapearFilasClientes(filasCrudas) {
  return filasCrudas.map((filaCruda) => {
    const fila = {};
    for (const [encabezadoOriginal, valor] of Object.entries(filaCruda)) {
      const clave = MAPEO_CLIENTES[normalizarEncabezado(encabezadoOriginal)];
      if (clave) fila[clave] = valor === null || valor === undefined ? null : String(valor).trim();
    }
    return fila;
  });
}

export function claveUnica(fila) {
  return `${fila.co}||${fila.nro_documento}||${fila.bodega}||${fila.referencia}`;
}
