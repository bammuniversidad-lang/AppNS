// Agrupa pedidos por un campo y calcula Valor solicitado, Valor facturado,
// NS Valor y % Pendiente, según las fórmulas de la Etapa 2.
export function agruparValorFacturado(filas, campo, etiquetaCampo) {
  const grupos = new Map();
  for (const f of filas) {
    const clave = f[campo] || '(sin dato)';
    if (!grupos.has(clave)) {
      grupos.set(clave, { [etiquetaCampo]: clave, valor_solicitado: 0, valor_facturado: 0 });
    }
    const g = grupos.get(clave);
    g.valor_solicitado += Number(f.valor_subtotal) || 0;
    if (f.cant_pedida > 0) {
      g.valor_facturado += (Number(f.valor_subtotal) / Number(f.cant_pedida)) * Number(f.cant_remision || 0);
    }
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    ns_valor: g.valor_solicitado > 0 ? g.valor_facturado / g.valor_solicitado : 0,
    porcentaje_pendiente: g.valor_solicitado > 0 ? 1 - g.valor_facturado / g.valor_solicitado : 0,
  }));
}

// Cuadros 4 y 5: por Responsable o por Motivo -> Valor, Cantidad total, Valor del pendiente
export function agruparResponsableMotivo(filas, campo, etiquetaCampo) {
  const grupos = new Map();
  for (const f of filas) {
    const clave = f[campo] || '(sin asignar)';
    if (!grupos.has(clave)) {
      grupos.set(clave, { [etiquetaCampo]: clave, valor: 0, cantidad_total: 0, valor_pendiente: 0 });
    }
    const g = grupos.get(clave);
    g.valor += Number(f.valor_subtotal) || 0;
    g.cantidad_total += Number(f.cant_pedida) || 0;
    if (f.cant_pedida > 0) {
      g.valor_pendiente += (Number(f.valor_subtotal) / Number(f.cant_pedida)) * Number(f.cant_pendiente || 0);
    }
  }
  return [...grupos.values()];
}

// Cuadro 6: descripción de ítem con pendiente > 0
export function agruparItemPendiente(filas) {
  const grupos = new Map();
  for (const f of filas) {
    if (!(Number(f.cant_pendiente) > 0)) continue;
    const clave = f.desc_item || '(sin descripción)';
    if (!grupos.has(clave)) {
      grupos.set(clave, { desc_item: clave, cantidad_pendiente: 0, valor_pendiente: 0 });
    }
    const g = grupos.get(clave);
    g.cantidad_pendiente += Number(f.cant_pendiente) || 0;
    if (f.cant_pedida > 0) {
      g.valor_pendiente += (Number(f.valor_subtotal) / Number(f.cant_pedida)) * Number(f.cant_pendiente || 0);
    }
  }
  return [...grupos.values()];
}

// Las mismas 4 tarjetas del módulo Pendientes (Pedidos, Líneas, Cantidad,
// Valor), calculadas en el cliente a partir de las filas ya filtradas.
// Replica la lógica de la función SQL get_pedidos_cards.
export function calcularTarjetasPedidos(filas) {
  const pedidosSet = new Set();
  const pedidosPendientesSet = new Set();
  const lineasSet = new Set();
  const lineasPendientesSet = new Set();
  let cantidadTotal = 0;
  let cantidadPendiente = 0;
  let valorTotal = 0;
  let valorPendiente = 0;

  for (const f of filas) {
    const clavePedido = `${f.co}||${f.nro_documento}`;
    const claveLinea = `${f.co}||${f.referencia}||${f.nro_documento}`;
    pedidosSet.add(clavePedido);
    lineasSet.add(claveLinea);
    const pendiente = Number(f.cant_pendiente) || 0;
    if (pendiente > 0) {
      pedidosPendientesSet.add(clavePedido);
      lineasPendientesSet.add(claveLinea);
    }
    cantidadTotal += Number(f.cant_pedida) || 0;
    cantidadPendiente += pendiente;
    valorTotal += Number(f.valor_subtotal) || 0;
    if (f.cant_pedida > 0) {
      valorPendiente += (Number(f.valor_subtotal) / Number(f.cant_pedida)) * pendiente;
    }
  }

  const pedidosTotales = pedidosSet.size;
  const pedidosConPendientes = pedidosPendientesSet.size;
  const lineasTotales = lineasSet.size;
  const lineasPendientes = lineasPendientesSet.size;

  return {
    pedidos_totales: pedidosTotales,
    pedidos_con_pendientes: pedidosConPendientes,
    ns_pedidos: pedidosTotales ? 1 - pedidosConPendientes / pedidosTotales : 0,
    lineas_totales: lineasTotales,
    lineas_pendientes: lineasPendientes,
    ns_lineas: lineasTotales ? 1 - lineasPendientes / lineasTotales : 0,
    cantidad_total: cantidadTotal,
    cantidad_pendiente: cantidadPendiente,
    ns_cantidad: cantidadTotal ? 1 - cantidadPendiente / cantidadTotal : 0,
    valor_total: valorTotal,
    valor_pendiente: valorPendiente,
    ns_valor: valorTotal ? 1 - valorPendiente / valorTotal : 0,
  };
}

// Gráfico 1: NS Valor por C.O.
export function calcularNsPorCO(filas) {
  const grupos = agruparValorFacturado(filas, 'co', 'co');
  return grupos.map((g) => ({ co: g.co, ns_valor: Number((g.ns_valor * 100).toFixed(1)) }));
}

// Gráfico 2: NS Valor por mes-año
export function calcularNsPorMes(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const fecha = f.fecha_actualizacion;
    if (!fecha) continue;
    const mesAnio = String(fecha).slice(0, 7); // YYYY-MM
    if (!grupos.has(mesAnio)) {
      grupos.set(mesAnio, { mes: mesAnio, valor_solicitado: 0, valor_facturado: 0 });
    }
    const g = grupos.get(mesAnio);
    g.valor_solicitado += Number(f.valor_subtotal) || 0;
    if (f.cant_pedida > 0) {
      g.valor_facturado += (Number(f.valor_subtotal) / Number(f.cant_pedida)) * Number(f.cant_remision || 0);
    }
  }
  return [...grupos.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((g) => ({
      mes: g.mes,
      ns_valor: g.valor_solicitado > 0 ? Number(((g.valor_facturado / g.valor_solicitado) * 100).toFixed(1)) : 0,
    }));
}
