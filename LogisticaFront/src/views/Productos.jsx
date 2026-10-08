'use client';

import Papa from 'papaparse';
import { useEffect, useRef, useState } from 'react';
import { mensajeError } from '../api/client';
import { productosApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { soles } from '../utils/format';

const VACIO = { id: null, sku: '', descripcion: '', precio: '', activo: true };

// Acepta encabezados con mayúsculas, tildes o nombres alternativos
const normalizar = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const COLUMNAS = {
  sku: ['sku', 'codigo', 'cod', 'codigo sku'],
  descripcion: ['descripcion', 'producto', 'nombre', 'detalle'],
  precio: ['precio', 'precio unitario', 'precio venta', 'pvp'],
};

/** "S/ 1,234.50" o "1234,5" → 1234.5 */
function leerPrecio(valor) {
  let t = String(valor ?? '').replace(/[^\d.,-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  return t === '' ? 0 : Number(t);
}

export default function Productos() {
  const { usuario } = useAuth();
  const puedeEditar = ['admin', 'planificador'].includes(usuario.rol);
  const [productos, setProductos] = useState([]);
  const [buscar, setBuscar] = useState('');
  const [form, setForm] = useState(VACIO);
  const [vistaPrevia, setVistaPrevia] = useState(null);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const archivo = useRef(null);

  const cargar = () => productosApi.listar(buscar ? { q: buscar } : {}).then(setProductos).catch((e) => setError(mensajeError(e)));
  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [buscar]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar(e) {
    e.preventDefault();
    setError('');
    try {
      const { id, ...body } = form;
      if (id) await productosApi.actualizar(id, body);
      else await productosApi.crear(body);
      setForm(VACIO);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  function leerArchivo(e) {
    const f = e.target.files[0];
    if (!f) return;
    setError('');
    setMensaje('');
    // Excel guarda "CSV" en Windows-1252; si las tildes llegan rotas, se vuelve a leer con esa codificación
    const leer = (encoding) => Papa.parse(f, {
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
        <h2>Productos</h2>
        {puedeEditar && (
          <div className="fila">
            <input ref={archivo} type="file" accept=".csv,text/csv" hidden onChange={leerArchivo} />
            <button className="btn-sec" onClick={() => archivo.current.click()}>Importar CSV</button>
          </div>
        )}
      </div>
      {mensaje && <p className="aviso">{mensaje}</p>}
      {error && <pre className="error">{error}</pre>}

      {vistaPrevia && (
        <section className="tarjeta">
          <h3>Vista previa: {vistaPrevia.length} filas</h3>
          <p>Se crean los SKU nuevos y se actualizan descripción y precio de los existentes.</p>
          <div className="tabla-scroll alto-limitado">
            <table>
              <thead><tr><th>SKU</th><th>Descripción</th><th>Precio</th></tr></thead>
              <tbody>
                {vistaPrevia.slice(0, 100).map((f, i) => (
                  <tr key={i} className={!f.sku || !f.descripcion || Number.isNaN(f.precio) ? 'fila-error' : ''}>
                    <td>{f.sku}</td><td>{f.descripcion}</td><td>{Number.isNaN(f.precio) ? '¿?' : soles(f.precio)}</td>
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

      {puedeEditar && (
        <form className="tarjeta form-grid" onSubmit={guardar}>
          <h3 className="ancho">{form.id ? `Editar ${form.sku}` : 'Nuevo producto'}</h3>
          <label>SKU *<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>
          <label className="ancho-2">Descripción *<input required value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></label>
          <label>Precio (S/)<input type="number" min="0" step="0.01" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Activo</label>
          <div className="fila ancho">
            <button>{form.id ? 'Actualizar' : 'Agregar'}</button>
            {form.id && <button type="button" className="btn-sec" onClick={() => setForm(VACIO)}>Cancelar</button>}
          </div>
        </form>
      )}

      <section className="tarjeta">
        <input placeholder="Buscar por SKU o descripción…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <p className="resumen-lista">{productos.length} producto(s)</p>
        <table>
          <thead><tr><th>SKU</th><th>Descripción</th><th>Precio</th><th>Estado</th>{puedeEditar && <th />}</tr></thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td><strong>{p.sku}</strong></td>
                <td>{p.descripcion}</td>
                <td>{soles(p.precio)}</td>
                <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                {puedeEditar && (
                  <td className="acciones">
                    <button className="btn-sec" onClick={() => { setForm({ ...p }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>
                  </td>
                )}
              </tr>
            ))}
            {!productos.length && <tr><td colSpan={5}>No hay productos. Importa un CSV con columnas sku, descripcion, precio.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
