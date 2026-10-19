'use client';

import Papa from 'papaparse';
import { useEffect, useRef, useState } from 'react';
import { mensajeError } from '../api/client';
import { bsaleApi, preciosApi, productosApi } from '../api/services';
import { fechaCorta, soles } from '../utils/format';

const COLUMNAS = [
  { clave: 'sku', titulo: 'SKU', ancho: 14 },
  { clave: 'producto', titulo: 'Producto', ancho: 55 },
  { clave: 'plataforma', titulo: 'Plataforma', ancho: 16 },
  { clave: 'fecha', titulo: 'Fecha', ancho: 13 },
  { clave: 'precio', titulo: 'Precio', ancho: 11 },
  { clave: 'precio_normal', titulo: 'Precio Normal', ancho: 15 },
];
const FILAS_CON_LISTA = 5000; // filas de la plantilla con la lista desplegable de plataformas
const PRODUCTOS_POR_ENVIO = 60;

const normal = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const dosDigitos = (n) => String(n).padStart(2, '0');

/** Valor de una celda de Excel como texto o número (fechas en AAAA-MM-DD). */
function valorCelda(v) {
  if (v == null) return '';
  if (v instanceof Date) return `${v.getUTCFullYear()}-${dosDigitos(v.getUTCMonth() + 1)}-${dosDigitos(v.getUTCDate())}`;
  if (typeof v === 'object') {
    if ('result' in v) return valorCelda(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
  }
  return typeof v === 'string' ? v.trim() : v;
}

/** Filas de la plantilla (xlsx o csv) → [{ fila, sku, plataforma, fecha, precio, precio_normal }]. */
async function leerArchivo(archivo) {
  let encabezado;
  let datos;
  if (/\.csv$/i.test(archivo.name)) {
    const texto = await archivo.text();
    const r = Papa.parse(texto, { skipEmptyLines: true });
    [encabezado, ...datos] = r.data;
  } else {
    const ExcelJS = (await import('exceljs')).default;
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await archivo.arrayBuffer());
    const hoja = libro.getWorksheet('Precios') ?? libro.worksheets[0];
    const filas = [];
    hoja.eachRow({ includeEmpty: false }, (fila, n) => {
      const valores = [];
      for (let c = 1; c <= COLUMNAS.length + 2; c++) valores.push(valorCelda(fila.getCell(c).value));
      filas.push({ n, valores });
    });
    encabezado = filas[0]?.valores ?? [];
    datos = filas.slice(1).map((f) => Object.assign(f.valores, { _fila: f.n }));
  }
  const indice = Object.fromEntries(COLUMNAS.map((c) => [c.clave, (encabezado ?? []).findIndex((h) => normal(h) === normal(c.titulo))]));
  const faltan = COLUMNAS.filter((c) => c.clave !== 'producto' && indice[c.clave] < 0).map((c) => c.titulo);
  if (faltan.length) throw new Error(`La plantilla no tiene las columnas: ${faltan.join(', ')}. Descarga la plantilla y úsala tal cual.`);
  return datos
    .map((v, i) => ({
      fila: v._fila ?? i + 2,
      sku: String(v[indice.sku] ?? '').trim(),
      plataforma: String(v[indice.plataforma] ?? '').trim(),
      fecha: v[indice.fecha] ?? '',
      precio: v[indice.precio] ?? '',
      precio_normal: v[indice.precio_normal] ?? '',
    }))
    .filter((f) => f.sku || f.plataforma || f.precio !== '');
}

/** Registro masivo de precios a partir de la plantilla de Excel. */
export default function PreciosCargaMasiva() {
  const [plataformas, setPlataformas] = useState([]);
  const [matriz, setMatriz] = useState([]);
  const [filtro, setFiltro] = useState({ q: '', categoria_id: '' });
  const [archivo, setArchivo] = useState(null);
  const [filas, setFilas] = useState(null);
  const [vacias, setVacias] = useState(0);
  const [revision, setRevision] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const input = useRef(null);

  useEffect(() => {
    preciosApi.plataformas().then((p) => setPlataformas(p.filter((x) => x.activo))).catch(() => {});
    productosApi.matriz().then(setMatriz).catch(() => {});
  }, []);

  /** Plantilla .xlsx: la columna Plataforma solo acepta las plataformas definidas (en mayúsculas). */
  async function descargarPlantilla(conPrecios) {
    setError('');
    setOcupado('Preparando la plantilla…');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const libro = new ExcelJS.Workbook();
      const hoja = libro.addWorksheet('Precios', { views: [{ state: 'frozen', ySplit: 1 }] });
      hoja.columns = COLUMNAS.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho }));
      hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B6CB0' } };
      hoja.getColumn('fecha').numFmt = 'dd/mm/yyyy';
      hoja.getColumn('precio').numFmt = '0.00';
      hoja.getColumn('precio_normal').numFmt = '0.00';

      const nombres = plataformas.map((p) => p.nombre.toUpperCase());
      const lista = libro.addWorksheet('Plataformas', { state: 'veryHidden' });
      nombres.forEach((n, i) => { lista.getCell(`A${i + 1}`).value = n; });

      let filasDatos = [];
      if (conPrecios) {
        const params = Object.fromEntries(Object.entries(filtro).filter(([, v]) => v !== ''));
        const vig = await preciosApi.vigentes({ ...params, limite: 5000 });
        filasDatos = vig.flatMap((r) => plataformas.map((p) => ({
          sku: r.sku, producto: r.descripcion, plataforma: p.nombre.toUpperCase(), fecha: null,
          precio: r.precios[p.nombre]?.precio != null ? Number(r.precios[p.nombre].precio) : null,
          precio_normal: r.precio_normal != null ? Number(r.precio_normal) : null,
        })));
        hoja.addRows(filasDatos);
      }
      const hasta = Math.max(FILAS_CON_LISTA, filasDatos.length + 500);
      const validacion = {
        type: 'list', allowBlank: true, formulae: [`Plataformas!$A$1:$A$${nombres.length}`],
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Plataforma no válida',
        error: `Elige una plataforma de la lista: ${nombres.join(', ')}`,
        showInputMessage: true, promptTitle: 'Plataforma', prompt: 'Elige de la lista (en mayúsculas)',
      };
      const monto = { type: 'decimal', operator: 'greaterThan', formulae: [0], allowBlank: true, showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Monto no válido', error: 'Escribe un monto mayor que 0' };
      for (let r = 2; r <= hasta; r++) {
        hoja.getCell(`C${r}`).dataValidation = validacion;
        hoja.getCell(`E${r}`).dataValidation = monto;
        hoja.getCell(`F${r}`).dataValidation = monto;
      }

      const ayuda = libro.addWorksheet('Instrucciones');
      ayuda.getColumn(1).width = 110;
      [
        'Cómo usar la plantilla de precios',
        '',
        '• Una fila por SKU y plataforma. La columna Producto es solo de referencia.',
        `• Plataforma: elige de la lista desplegable. Solo se aceptan, en mayúsculas: ${nombres.join(', ')}.`,
        '• Fecha: DD/MM/AAAA. Vacía = hoy. No puede ser futura.',
        '• Precio y Precio Normal en soles con IGV. El precio no puede ser mayor que el normal. Precio Normal vacío = no cambia.',
        '• Las filas sin precio se ignoran, y las que tienen el mismo precio vigente no se registran otra vez.',
        '• Sube el archivo en Precios → Registrar precios → Masivo. Primero se revisa y luego confirmas.',
      ].forEach((t, i) => { ayuda.getCell(`A${i + 1}`).value = t; });
      ayuda.getCell('A1').font = { bold: true, size: 14 };

      const buffer = await libro.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = conPrecios ? 'plantilla-precios-actuales.xlsx' : 'plantilla-precios.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      if (conPrecios) setAviso(`Plantilla con ${filasDatos.length} filas (${filasDatos.length / Math.max(plataformas.length, 1)} SKU × ${plataformas.length} plataformas). Cambia solo los precios que quieras.`);
    } catch (err) {
      setError(err.response ? mensajeError(err) : err.message);
    } finally {
      setOcupado('');
    }
  }

  async function elegirArchivo(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setAviso('');
    setRevision(null);
    setArchivo(f.name);
    setOcupado('Leyendo el archivo…');
    try {
      const todas = await leerArchivo(f);
      const conPrecio = todas.filter((x) => x.precio !== '' && x.precio != null);
      setVacias(todas.length - conPrecio.length);
      if (!conPrecio.length) throw new Error('El archivo no tiene filas con precio');
      setFilas(conPrecio);
      setOcupado('Revisando…');
      setRevision(await preciosApi.importar(conPrecio, false));
    } catch (err) {
      setFilas(null);
      setError(err.response ? mensajeError(err) : err.message);
    } finally {
      setOcupado('');
    }
  }

  async function confirmar() {
    const n = revision.resumen.cambios;
    if (!window.confirm(`Se registrarán ${n} precio(s) de ${revision.resumen.productos} SKU y se enviarán a Bsale. ¿Continuar?`)) return;
    setError('');
    setAviso('');
    try {
      // se envía por grupos de SKU (cada SKU completo en un mismo envío)
      const porSku = new Map();
      for (const f of filas) {
        const k = f.sku.trim().toUpperCase();
        if (!porSku.has(k)) porSku.set(k, []);
        porSku.get(k).push(f);
      }
      const grupos = [...porSku.values()];
      const ids = [];
      let registrados = 0;
      for (let i = 0; i < grupos.length; i += PRODUCTOS_POR_ENVIO) {
        setOcupado(`Registrando precios… ${Math.min(i, grupos.length)} de ${grupos.length} SKU`);
        const r = await preciosApi.importar(grupos.slice(i, i + PRODUCTOS_POR_ENVIO).flat(), true);
        if (r.resumen.errores) throw new Error(`Se detuvo en el grupo ${i / PRODUCTOS_POR_ENVIO + 1}: hay errores; vuelve a subir el archivo`);
        registrados += r.registrados ?? 0;
        ids.push(...(r.producto_ids ?? []));
      }
      const textoBsale = await enviarABsale(ids);
      setAviso(`${registrados} precio(s) registrados ✔${textoBsale}`);
      setRevision(null);
      setFilas(null);
      setArchivo(null);
    } catch (err) {
      setError(err.response ? mensajeError(err) : err.message);
    } finally {
      setOcupado('');
    }
  }

  /** Envía a Bsale los precios de los productos cambiados (de a poco, hasta que no quede nada). */
  async function enviarABsale(ids) {
    if (!ids.length) return '';
    try {
      const estado = await bsaleApi.estado();
      if (!estado.activo) return '';
      if (!estado.lectura?.productos) return ' · Para enviarlos a Bsale, primero pulsa “Leer Bsale” en Precios → Bsale.';
      let enviados = 0;
      let errores = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        for (let vuelta = 0; vuelta < 100; vuelta++) {
          setOcupado(`Enviando a Bsale… ${enviados} precio(s)`);
          const r = await bsaleApi.enviarPrecios(lote);
          enviados += r.enviados;
          errores = r.errores;
          if (!r.pendientes || (!r.enviados && r.errores)) break;
        }
      }
      return ` · Bsale: ${enviados} precio(s) actualizados${errores ? `, ${errores} con error (ver Precios → Bsale → Registro)` : ' ✔'}`;
    } catch (err) {
      return ` · ⚠ No se pudo enviar a Bsale: ${mensajeError(err)}. Puedes reenviarlos desde Precios → Bsale.`;
    }
  }

  const r = revision?.resumen;
  return (
    <>
      <section className="tarjeta">
        <h3>1. Descarga la plantilla</h3>
        <p><small>Columnas: SKU · Producto · Plataforma · Fecha · Precio · Precio Normal. La plataforma se elige de una lista con las plataformas definidas (en mayúsculas): {plataformas.map((p) => p.nombre.toUpperCase()).join(', ')}.</small></p>
        <div className="fila filtros">
          <button className="btn-sec" onClick={() => descargarPlantilla(false)} disabled={!!ocupado || !plataformas.length}>⬇ Plantilla vacía</button>
          <span className="separador">o con los precios actuales de</span>
          <input className="crece" placeholder="SKU o nombre (vacío = todos)" value={filtro.q} onChange={(e) => setFiltro({ ...filtro, q: e.target.value })} />
          <select value={filtro.categoria_id} onChange={(e) => setFiltro({ ...filtro, categoria_id: e.target.value })}>
            <option value="">Todas las categorías</option>
            {matriz.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
          <button className="btn-sec" onClick={() => descargarPlantilla(true)} disabled={!!ocupado || !plataformas.length}>⬇ Plantilla con precios</button>
        </div>
      </section>

      <section className="tarjeta">
        <h3>2. Sube la plantilla llena</h3>
        <div className="fila">
          <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={elegirArchivo} />
          <button onClick={() => input.current.click()} disabled={!!ocupado}>⬆ Subir archivo (.xlsx o .csv)</button>
          {archivo && <small>{archivo}</small>}
        </div>
        {ocupado && <p className="aviso">⏳ {ocupado}</p>}
        {error && <p className="error">{error}</p>}
        {aviso && <p className="aviso">{aviso}</p>}
      </section>

      {r && (
        <section className="tarjeta">
          <h3>3. Revisa y confirma</h3>
          <div className="resumen-reporte">
            <div><strong>{r.filas}</strong><small>Filas con precio</small></div>
            <div><strong>{r.cambios}</strong><small>Precios que cambian</small></div>
            <div><strong>{r.productos}</strong><small>SKU</small></div>
            <div><strong>{r.sin_cambio}</strong><small>Sin cambio (se omiten)</small></div>
            {vacias > 0 && <div><strong>{vacias}</strong><small>Filas sin precio (se ignoran)</small></div>}
            <div className={r.errores ? 'alerta' : ''}><strong>{r.errores}</strong><small>Con error</small></div>
          </div>

          {r.errores > 0 ? (
            <>
              <p className="error">Corrige estas filas en el Excel y vuelve a subirlo. No se registra nada mientras haya errores.</p>
              <div className="tabla-scroll alto-limitado">
                <table>
                  <thead><tr><th>Fila</th><th>SKU</th><th>Problema</th></tr></thead>
                  <tbody>{revision.errores.map((e, i) => <tr key={i}><td>{e.fila}</td><td>{e.sku}</td><td>{e.mensaje}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="tabla-scroll alto-limitado">
                <table>
                  <thead><tr><th>Fila</th><th>SKU</th><th>Producto</th><th>Plataforma</th><th>Fecha</th><th className="num">Antes</th><th className="num">Nuevo</th><th className="num">P. Normal</th></tr></thead>
                  <tbody>
                    {revision.cambios.map((c) => (
                      <tr key={`${c.fila}`}>
                        <td>{c.fila}</td><td>{c.sku}</td><td>{c.descripcion}</td><td>{c.plataforma}</td><td>{fechaCorta(c.fecha)}</td>
                        <td className="num">{c.antes != null ? soles(c.antes) : '—'}</td>
                        <td className={`num ${c.antes != null && c.precio < c.antes ? 'baja' : 'sube'}`}>{soles(c.precio)}</td>
                        <td className="num">{c.precio_normal != null ? soles(c.precio_normal) : <small>sin cambio</small>}</td>
                      </tr>
                    ))}
                    {!revision.cambios.length && <tr><td colSpan={8}>No hay precios distintos a los vigentes: no hay nada que registrar.</td></tr>}
                  </tbody>
                </table>
              </div>
              {revision.cambios.length >= 1000 && <small>Se muestran los primeros 1000 cambios.</small>}
              <div className="fila">
                <button onClick={confirmar} disabled={!!ocupado || !r.cambios}>Registrar {r.cambios} precio(s)</button>
                <button className="btn-sec" onClick={() => { setRevision(null); setFilas(null); setArchivo(null); }} disabled={!!ocupado}>Cancelar</button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
