const ESTILO_ENCABEZADO = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
  alignment: { horizontal: 'center', vertical: 'middle' },
};

function agregarHoja(libro, nombre, columnas, filas) {
  const hoja = libro.addWorksheet(nombre.slice(0, 31));
  hoja.columns = columnas.map((c) => ({ header: c.etiqueta, key: c.clave, width: c.ancho || 22 }));
  hoja.getRow(1).eachCell((celda) => { Object.assign(celda, ESTILO_ENCABEZADO); });
  filas.forEach((f) => {
    const fila = hoja.addRow(f);
    columnas.forEach((c, i) => {
      if (c.formato) fila.getCell(i + 1).numFmt = c.formato;
    });
  });
  hoja.autoFilter = { from: 'A1', to: `${String.fromCharCode(65 + columnas.length - 1)}1` };
  return hoja;
}

const FORMATO_MONEDA = '#,##0';
const FORMATO_PORCENTAJE = '0.0%';

export async function exportarDashboardExcel({ tarjetas, cuadros, nombreArchivo }) {
  const ExcelJS = (await import('exceljs')).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Aplicación Abastecimiento';
  libro.created = new Date();

  // Resumen
  const hojaResumen = libro.addWorksheet('Resumen');
  hojaResumen.columns = [{ header: 'Indicador', key: 'a', width: 30 }, { header: 'Valor', key: 'b', width: 20 }];
  hojaResumen.getRow(1).eachCell((c) => Object.assign(c, ESTILO_ENCABEZADO));
  const filasResumen = [
    ['Pedidos totales', tarjetas.pedidos_totales],
    ['Pedidos con pendientes', tarjetas.pedidos_con_pendientes],
    ['NS Pedidos', tarjetas.ns_pedidos],
    ['Líneas totales', tarjetas.lineas_totales],
    ['Líneas pendientes', tarjetas.lineas_pendientes],
    ['NS Líneas', tarjetas.ns_lineas],
    ['Cantidad total', tarjetas.cantidad_total],
    ['Cantidad pendiente', tarjetas.cantidad_pendiente],
    ['NS Cantidad', tarjetas.ns_cantidad],
    ['Valor total', tarjetas.valor_total],
    ['Valor pendiente', tarjetas.valor_pendiente],
    ['NS Valor', tarjetas.ns_valor],
    ['NS Total', tarjetas.ns_total],
  ];
  filasResumen.forEach(([a, b]) => hojaResumen.addRow({ a, b }));
  ['ns_pedidos', 'ns_lineas', 'ns_cantidad', 'ns_valor', 'ns_total'].forEach(() => {});
  hojaResumen.getColumn('b').eachCell((celda, num) => {
    if (num > 1) {
      const etiqueta = hojaResumen.getCell(`A${num}`).value;
      if (String(etiqueta).startsWith('NS')) celda.numFmt = FORMATO_PORCENTAJE;
      else celda.numFmt = FORMATO_MONEDA;
    }
  });

  agregarHoja(libro, 'Por proveedor', [
    { clave: 'proveedor', etiqueta: 'Proveedor', ancho: 30 },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_facturado', etiqueta: 'Valor facturado', formato: FORMATO_MONEDA },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_proveedor);

  agregarHoja(libro, 'Por vendedor', [
    { clave: 'nombre_vendedor', etiqueta: 'Vendedor', ancho: 30 },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_facturado', etiqueta: 'Valor facturado', formato: FORMATO_MONEDA },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_vendedor);

  agregarHoja(libro, 'Por cliente', [
    { clave: 'razon_social_cliente_despacho', etiqueta: 'Cliente', ancho: 34 },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_facturado', etiqueta: 'Valor facturado', formato: FORMATO_MONEDA },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_cliente);

  agregarHoja(libro, 'Por responsable', [
    { clave: 'responsable', etiqueta: 'Responsable', ancho: 30 },
    { clave: 'valor', etiqueta: 'Valor', formato: FORMATO_MONEDA },
    { clave: 'cantidad_total', etiqueta: 'Cantidad total', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor del pendiente', formato: FORMATO_MONEDA },
  ], cuadros.por_responsable);

  agregarHoja(libro, 'Por motivo', [
    { clave: 'motivo', etiqueta: 'Motivo', ancho: 30 },
    { clave: 'valor', etiqueta: 'Valor', formato: FORMATO_MONEDA },
    { clave: 'cantidad_total', etiqueta: 'Cantidad total', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor del pendiente', formato: FORMATO_MONEDA },
  ], cuadros.por_motivo);

  agregarHoja(libro, 'Items con pendiente', [
    { clave: 'desc_item', etiqueta: 'Descripción ítem', ancho: 34 },
    { clave: 'cantidad_pendiente', etiqueta: 'Cantidad pendiente', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
  ], cuadros.por_item_pendiente);

  agregarHoja(libro, 'Por motivo e item', [
    { clave: 'motivo', etiqueta: 'Motivo', ancho: 26 },
    { clave: 'desc_item', etiqueta: 'Descripción ítem', ancho: 34 },
    { clave: 'cantidad_pendiente', etiqueta: 'Cantidad pendiente', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
  ], cuadros.por_motivo_item);

  agregarHoja(libro, 'Clasificacion referencia', [
    { clave: 'clasificacion', etiqueta: 'Clasificación', ancho: 14 },
    { clave: 'cantidad_referencias', etiqueta: 'Cant. referencias', formato: FORMATO_MONEDA },
    { clave: 'valor_solicitado', etiqueta: 'Valor solicitado', formato: FORMATO_MONEDA },
    { clave: 'valor_facturado', etiqueta: 'Valor facturado', formato: FORMATO_MONEDA },
    { clave: 'valor_pendiente', etiqueta: 'Valor pendiente', formato: FORMATO_MONEDA },
    { clave: 'ns_valor', etiqueta: 'NS Valor', formato: FORMATO_PORCENTAJE },
    { clave: 'porcentaje_pendiente', etiqueta: '% Pendiente', formato: FORMATO_PORCENTAJE },
  ], cuadros.por_clasificacion_referencia);

  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportarDashboardPowerPoint({ tarjetas, cuadros, graficos, resumenFiltros, nombreArchivo }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'DASH', width: 10, height: 5.63 });
  pres.layout = 'DASH';

  const azul = '1565C0';
  const MARGEN_X = 0.4;
  const ANCHO_UTIL = 9.2; // 10 - 2*0.4, para que ninguna tabla se salga del margen

  // Portada
  const portada = pres.addSlide();
  portada.background = { color: 'F4F7FB' };
  portada.addText('Dashboard — Nivel de servicio de abastecimiento', {
    x: MARGEN_X, y: 1.8, w: ANCHO_UTIL, h: 1, fontSize: 26, bold: true, color: azul,
  });
  portada.addText(resumenFiltros || 'Todos los datos', {
    x: MARGEN_X, y: 2.7, w: ANCHO_UTIL, h: 0.8, fontSize: 13, color: '444444',
  });
  portada.addText(new Date().toLocaleDateString('es-CO'), {
    x: MARGEN_X, y: 5.0, w: ANCHO_UTIL, h: 0.4, fontSize: 10, color: '888888',
  });

  // KPIs
  const kpis = pres.addSlide();
  kpis.addText('Indicadores generales', { x: MARGEN_X, y: 0.3, fontSize: 20, bold: true, color: azul });
  const datosKpi = [
    ['Pedidos', `${tarjetas.pedidos_totales} totales / ${tarjetas.pedidos_con_pendientes} pendientes`, `${(tarjetas.ns_pedidos * 100).toFixed(1)}%`],
    ['Líneas', `${tarjetas.lineas_totales} totales / ${tarjetas.lineas_pendientes} pendientes`, `${(tarjetas.ns_lineas * 100).toFixed(1)}%`],
    ['Cantidad', `${Math.round(tarjetas.cantidad_total).toLocaleString('es-CO')} / ${Math.round(tarjetas.cantidad_pendiente).toLocaleString('es-CO')}`, `${(tarjetas.ns_cantidad * 100).toFixed(1)}%`],
    ['Valor', `${Math.round(tarjetas.valor_total).toLocaleString('es-CO')} / ${Math.round(tarjetas.valor_pendiente).toLocaleString('es-CO')}`, `${(tarjetas.ns_valor * 100).toFixed(1)}%`],
    ['NS Total', '', `${(tarjetas.ns_total * 100).toFixed(1)}%`],
  ];
  kpis.addTable(
    [
      [{ text: 'Indicador', options: { bold: true, fill: { color: azul }, color: 'FFFFFF' } },
       { text: 'Detalle', options: { bold: true, fill: { color: azul }, color: 'FFFFFF' } },
       { text: 'NS', options: { bold: true, fill: { color: azul }, color: 'FFFFFF' } }],
      ...datosKpi.map((f) => f.map((v) => ({ text: String(v) }))),
    ],
    { x: MARGEN_X, y: 0.9, w: ANCHO_UTIL, fontSize: 12, border: { type: 'solid', color: 'CCCCCC', pt: 1 }, autoPage: false }
  );

  // ---- Gráficos nativos de PowerPoint (editables, no son una imagen) ----
  if (graficos?.graficoCO?.length) {
    const s = pres.addSlide();
    s.addText('Gráfico 1: NS Valor por C.O. — periodo seleccionado', { x: MARGEN_X, y: 0.3, fontSize: 16, bold: true, color: azul });
    s.addChart(pres.ChartType.bar, [
      { name: 'Periodo seleccionado', labels: graficos.graficoCO.map((g) => g.co), values: graficos.graficoCO.map((g) => g.periodo_actual) },
    ], { x: MARGEN_X, y: 0.9, w: ANCHO_UTIL, h: 4.3, showLegend: true, legendPos: 'b', showValAxisTitle: false, catAxisLabelFontSize: 10, dataLabelFontSize: 9, showTitle: false, valAxisLabelFormatCode: '0"%"' });
  }

  if (graficos?.graficoDia?.length) {
    const s = pres.addSlide();
    s.addText('Gráfico 2: NS Total día a día', { x: MARGEN_X, y: 0.3, fontSize: 16, bold: true, color: azul });
    s.addChart(pres.ChartType.line, [
      { name: 'NS Total', labels: graficos.graficoDia.map((g) => g.dia.slice(-2).replace(/^0/, '')), values: graficos.graficoDia.map((g) => g.ns_total) },
    ], { x: MARGEN_X, y: 0.9, w: ANCHO_UTIL, h: 4.3, showLegend: false, catAxisLabelFontSize: 9, dataLabelFontSize: 9, lineDataSymbol: 'circle', valAxisLabelFormatCode: '0"%"' });
  }

  function agregarSlideTabla(titulo, encabezados, filas) {
    const slide = pres.addSlide();
    slide.addText(titulo, { x: MARGEN_X, y: 0.3, fontSize: 16, bold: true, color: azul });
    const TOPE = 15;
    const filasLimitadas = filas.slice(0, TOPE);
    const tabla = [
      encabezados.map((h) => ({ text: h, options: { bold: true, fill: { color: azul }, color: 'FFFFFF', fontSize: 10 } })),
      ...filasLimitadas.map((fila) => fila.map((v) => ({ text: String(v ?? ''), options: { fontSize: 9 } }))),
    ];
    slide.addTable(tabla, { x: MARGEN_X, y: 0.85, w: ANCHO_UTIL, fontSize: 9, border: { type: 'solid', color: 'DDDDDD', pt: 0.5 }, autoPage: false });
    const nota = filas.length > TOPE
      ? `Mostrando el top ${TOPE} de ${filas.length} registros (ordenado de mayor a menor). Descarga el Excel para verlos todos.`
      : `Mostrando los ${filas.length} registros de este cuadro.`;
    slide.addText(nota, { x: MARGEN_X, y: 5.3, w: ANCHO_UTIL, fontSize: 9, italic: true, color: '888888' });
  }

  agregarSlideTabla('Cuadro 1: Detalle por proveedor (top 15 por valor solicitado)', ['Proveedor', 'Valor solicitado', 'Valor facturado', 'NS Valor'],
    cuadros.por_proveedor.map((f) => [f.proveedor, Math.round(f.valor_solicitado).toLocaleString('es-CO'), Math.round(f.valor_facturado).toLocaleString('es-CO'), `${(f.ns_valor * 100).toFixed(1)}%`]));

  agregarSlideTabla('Cuadro 2: Detalle por vendedor (top 15 por valor solicitado)', ['Vendedor', 'Valor solicitado', 'Valor facturado', 'NS Valor'],
    cuadros.por_vendedor.map((f) => [f.nombre_vendedor, Math.round(f.valor_solicitado).toLocaleString('es-CO'), Math.round(f.valor_facturado).toLocaleString('es-CO'), `${(f.ns_valor * 100).toFixed(1)}%`]));

  agregarSlideTabla('Cuadro 3: Detalle por cliente (top 15 por valor solicitado)', ['Cliente', 'Valor solicitado', 'Valor facturado', 'NS Valor'],
    cuadros.por_cliente.map((f) => [f.razon_social_cliente_despacho, Math.round(f.valor_solicitado).toLocaleString('es-CO'), Math.round(f.valor_facturado).toLocaleString('es-CO'), `${(f.ns_valor * 100).toFixed(1)}%`]));

  agregarSlideTabla('Cuadro 6: Ítems con pendiente (top 15 por valor pendiente)', ['Descripción ítem', 'Cantidad pendiente', 'Valor pendiente'],
    cuadros.por_item_pendiente.map((f) => [f.desc_item, Math.round(f.cantidad_pendiente).toLocaleString('es-CO'), Math.round(f.valor_pendiente).toLocaleString('es-CO')]));

  agregarSlideTabla('Cuadro 7: Detalle por motivo e ítem (top 15 por valor pendiente)', ['Motivo', 'Descripción ítem', 'Cantidad pendiente', 'Valor pendiente'],
    cuadros.por_motivo_item.map((f) => [f.motivo, f.desc_item, Math.round(f.cantidad_pendiente).toLocaleString('es-CO'), Math.round(f.valor_pendiente).toLocaleString('es-CO')]));

  agregarSlideTabla('Cuadro 8: Detalle por clasificación de referencia', ['Clasificación', 'Cant. referencias', 'Valor solicitado', 'Valor facturado', 'NS Valor'],
    cuadros.por_clasificacion_referencia.map((f) => [f.clasificacion, f.cantidad_referencias, Math.round(f.valor_solicitado).toLocaleString('es-CO'), Math.round(f.valor_facturado).toLocaleString('es-CO'), `${(f.ns_valor * 100).toFixed(1)}%`]));

  await pres.writeFile({ fileName: nombreArchivo });
}
