'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mensajeError } from '../api/client';
import { productosApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { descargarCsv } from '../utils/csv';
import { soles } from '../utils/format';
import { tiene } from '../utils/roles';

// Acepta encabezados con mayúsculas, tildes o nombres alternativos
const normalizar = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const COLUMNAS = {
  sku: ['sku', 'codigo', 'cod', 'codigo sku'],
  descripcion: ['descripcion', 'producto', 'nombre', 'detalle', 'nombre almacen'],
  precio: ['precio', 'precio unitario', 'precio venta', 'pvp', 'web'],
};

/** "S/ 1,234.50" o "1234,5" → 1234.5 */
function leerPrecio(valor) {
  let t = String(valor ?? '').replace(/[^\d.,-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  return t === '' ? 0 : Number(t);
}

const FILTROS = { q: '', categoria_id: '', subcategoria_id: '', marca_id: '', tipo: '', estado_sourcing: '', sin_clasificar: '' };

/** Catálogo de SKU con filtros (módulo Productos). */
export default function Productos() {
  const { usuario } = useAuth();
  const catalogos = useCatalogos().catalogos ?? {};
  const puedeEditar = tiene(usuario, 'admin', 'catalogo');
  const [productos, setProductos] = useState([]);
  const [matriz, setMatriz] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [filtros, setFiltros] = useState(FILTROS);
  const [vistaPrevia, setVistaPrevia] = useState(null);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const archivo = useRef(null);

  useEffect(() => {
    productosApi.matriz().then(setMatriz).catch(() => {});
    productosApi.marcas().then(setMarcas).catch(() => {});
  }, []);

  const params = useMemo(() => Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '')), [filtros]);
  const cargar = () => productosApi.listar({ ...params, limite: 5000 }).then(setProductos).catch((e) => setError(mensajeError(e)));
  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const subcategorias = matriz.find((c) => String(c.id) === filtros.categoria_id)?.subcategorias ?? [];
  const f = (campo) => ({ value: filtros[campo], onChange: (e) => setFiltros({ ...filtros, [campo]: e.target.value, ...(campo === 'categoria_id' ? { subcategoria_id: '' } : {}) }) });

  function exportar() {
    descargarCsv('catalogo-sku.csv', [
      { titulo: 'Categoría', valor: (p) => p.categoria }, { titulo: 'Cód. Categoría', valor: (p) => p.cod_categoria },
      { titulo: 'Subcategoría', valor: (p) => p.subcategoria }, { titulo: 'Cód. Subcategoría', valor: (p) => p.cod_subcategoria },
      { titulo: 'Tipo', valor: (p) => p.tipo }, { titulo: 'Asignación', valor: (p) => p.asignacion },
      { titulo: 'Nombre Almacén', valor: (p) => p.descripcion }, { titulo: 'SKU', valor: (p) => p.sku },
      { titulo: 'Marca', valor: (p) => p.marca }, { titulo: 'Modelo', valor: (p) => p.modelo },
      { titulo: 'Estado de Sourcing', valor: (p) => p.estado_sourcing },
      { titulo: 'Garantía (meses)', valor: (p) => p.garantia_meses }, { titulo: 'Peso (kg)', valor: (p) => p.peso_kg },
      { titulo: 'Largo (cm)', valor: (p) => p.largo_cm }, { titulo: 'Ancho (cm)', valor: (p) => p.ancho_cm },
      { titulo: 'Alto (cm)', valor: (p) => p.alto_cm }, { titulo: 'Volumen (m³)', valor: (p) => p.volumen_m3 },
      { titulo: 'Talla', valor: (p) => p.talla }, { titulo: 'Estado de Verificación', valor: (p) => p.estado_verificacion },
      { titulo: 'Precio Normal', valor: (p) => p.precio_normal }, { titulo: 'Web', valor: (p) => p.precio },
      { titulo: 'Link para Información', valor: (p) => p.link_info }, { titulo: 'Activo', valor: (p) => (p.activo ? 'Sí' : 'No') },
    ], productos);
  }

  function leerArchivo(e) {
    const archivoCsv = e.target.files[0];
    if (!archivoCsv) return;
    setError('');
    setMensaje('');
    // Excel guarda "CSV" en Windows-1252; si las tildes llegan rotas, se vuelve a leer con esa codificación
    const leer = (encoding) => Papa.parse(archivoCsv, {
      header: true,
      skipEmptyLines: 'greedy',
      encoding,
      complete: ({ data, meta }) => {
        if (encoding === 'UTF-8' && JSON.stringify(data).includes(String.fromCharCode(0xfffd))) return leer('windows-1252');
        const mapa = {};
        for (const [campo, alias] of Object.entries(COLUMNAS)) {
          mapa[campo] = meta.fields.find((h) => alias.includes(normalizar(h)));
        }
        if (!mapa.sku || !mapa.descripcion) {
          setError(`El CSV debe tener columnas "sku" y "descripcion" (y opcional "precio"). Encontradas: ${meta.fields.join(', ')}`);
          return;
        }
        setVistaPrevia(data.map((fila) => ({
          sku: String(fila[mapa.sku] ?? '').trim(),
          descripcion: String(fila[mapa.descripcion] ?? '').trim(),
          precio: mapa.precio ? leerPrecio(fila[mapa.precio]) : 0,
        })));
      },
      error: (err) => setError(err.message),
    });
    leer('UTF-8');
    e.target.value = '';
  }

  async function importar() {
    setError('');
    try {
      const r = await productosApi.importar(vistaPrevia);
      setMensaje(`Importación lista: ${r.creados} creados, ${r.actualizados} actualizados.`);
      setVistaPrevia(null);
      cargar();
    } catch (err) {
      const detalles = err.response?.data?.details;
      setError(mensajeError(err) + (detalles ? `\n${detalles.slice(0, 10).map((d) => `Fila ${d.fila}: ${d.error}`).join('\n')}` : ''));
    }
  }

  return (
    <>
      <div className="encabezado">
        <h2>Catálogo de SKU</h2>
        <div className="fila">
          <button className="btn-sec" onClick={exportar} disabled={!productos.length}>⬇ Excel (CSV)</button>
          {puedeEditar && (
            <>
              <input ref={archivo} type="file" accept=".csv,text/csv" hidden onChange={leerArchivo} />
              <button className="btn-sec" onClick={() => archivo.current.click()}>Importar CSV simple</button>
              <Link className="btn" href="/productos/nuevo">+ Nuevo SKU</Link>
            </>
          )}
        </div>
      </div>
      {mensaje && <p className="aviso">{mensaje}</p>}
      {error && <pre className="error">{error}</pre>}

      {vistaPrevia && (
        <section className="tarjeta">
          <h3>Vista previa: {vistaPrevia.length} filas</h3>
          <p>Se crean los SKU nuevos y se actualizan nombre y precio Web de los existentes.</p>
          <div className="tabla-scroll alto-limitado">
            <table>
              <thead><tr><th>SKU</th><th>Nombre</th><th>Precio Web</th></tr></thead>
              <tbody>
                {vistaPrevia.slice(0, 100).map((x, i) => (
                  <tr key={i} className={!x.sku || !x.descripcion || Number.isNaN(x.precio) ? 'fila-error' : ''}>
                    <td>{x.sku}</td><td>{x.descripcion}</td><td>{Number.isNaN(x.precio) ? '¿?' : soles(x.precio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vistaPrevia.length > 100 && <small>…y {vistaPrevia.length - 100} filas más</small>}
          <div className="fila">
            <button onClick={importar}>Importar {vistaPrevia.length} productos</button>
            <button className="btn-sec" onClick={() => setVistaPrevia(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <section className="tarjeta">
        <div className="fila filtros">
          <input className="crece" placeholder="Buscar por SKU, nombre o modelo…" {...f('q')} />
          <select {...f('categoria_id')}>
            <option value="">Todas las categorías</option>
            {matriz.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
          <select {...f('subcategoria_id')} disabled={!filtros.categoria_id}>
            <option value="">Todas las subcategorías</option>
            {subcategorias.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>)}
          </select>
          <select {...f('marca_id')}>
            <option value="">Todas las marcas</option>
            {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          <select {...f('tipo')}>
            <option value="">Todos los tipos</option>
            {(catalogos.tiposProducto ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={filtros.sin_clasificar === '1'} onChange={(e) => setFiltros({ ...filtros, sin_clasificar: e.target.checked ? '1' : '' })} /> Sin categoría nueva</label>
          <select {...f('estado_sourcing')}>
            <option value="">Todo sourcing</option>
            {(catalogos.estadosSourcing ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <p className="resumen-lista">{productos.length} SKU</p>
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr><th>SKU</th><th>Nombre Almacén</th><th>Categoría / Subcategoría</th><th>Tipo</th><th>Marca</th><th>Sourcing</th><th>P. Normal</th><th>Web</th><th>Bsale</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                  <td><Link href={`/productos/${p.id}`}><strong>{p.sku}</strong></Link></td>
                  <td>{p.descripcion}{p.modelo && <small>{p.modelo}</small>}</td>
                  <td>{p.categoria ?? <><small className="error">sin categoría nueva</small>{p.categoria_anterior && <small>antes: {p.categoria_anterior} / {p.subcategoria_anterior}</small>}</>}{p.subcategoria && <small>{p.subcategoria}</small>}</td>
                  <td>{p.tipo}</td>
                  <td>{p.marca ?? '—'}</td>
                  <td>{p.estado_sourcing}</td>
                  <td>{p.precio_normal != null ? soles(p.precio_normal) : '—'}</td>
                  <td>{soles(p.precio)}</td>
                  <td title={p.bsale_tipo ? `Tipo en Bsale: ${p.bsale_tipo}` : ''}>{p.bsale_variante_id ? <>✔{p.bsale_clasificacion === 3 && <small>pack</small>}</> : <small>no está</small>}</td>
                  <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                </tr>
              ))}
              {!productos.length && <tr><td colSpan={10}>No hay productos con estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
