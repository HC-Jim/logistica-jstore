'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { bsaleApi, productosApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { descargarCsv } from '../utils/csv';
import { tiene } from '../utils/roles';

/** Matriz de categorías y subcategorías con sus códigos (base del SKU). */
export default function MatrizCategorias() {
  const { usuario } = useAuth();
  const puedeEditar = tiene(usuario, 'admin', 'catalogo');
  const [matriz, setMatriz] = useState([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [bsale, setBsale] = useState(null);
  const [nueva, setNueva] = useState({ codigo: '', nombre: '' });
  const [nuevaSub, setNuevaSub] = useState({}); // por categoría

  const cargar = () => productosApi.matriz().then(setMatriz).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); bsaleApi.estadoCatalogo().then(setBsale).catch(() => {}); }, []);

  async function accion(fn) {
    setError('');
    try {
      await fn();
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  const renombrar = (tipo, item) => {
    const nombre = prompt(`Nuevo nombre para "${item.nombre}"`, item.nombre);
    if (!nombre || nombre === item.nombre) return;
    accion(async () => { const r = await (tipo === 'cat' ? productosApi.guardarCategoria(item.id, { nombre }) : productosApi.guardarSubcategoria(item.id, { nombre })); if (r?.bsale) setAviso(r.bsale.ok ? `Renombrada ✔ · ${r.bsale.mensaje}` : `Renombrada ✔ · ⚠ Bsale: ${r.bsale.mensaje}`); });
  };

  function exportar() {
    descargarCsv('matriz-categorias.csv', [
      { titulo: 'Categoría', valor: (f) => f.categoria }, { titulo: 'Cód_Categoría', valor: (f) => f.cod_cat },
      { titulo: 'Subcategoría', valor: (f) => f.nombre }, { titulo: 'Cód_Subcategoría', valor: (f) => f.codigo },
    ], matriz.flatMap((c) => c.subcategorias.map((s) => ({ ...s, categoria: c.nombre, cod_cat: c.codigo }))));
  }

  return (
    <>
      <div className="encabezado">
        <h2>Matriz de categorías</h2>
        <button className="btn-sec" onClick={exportar}>⬇ Excel (CSV)</button>
      </div>
      <p><small>El SKU se arma con <strong>código de categoría (2) + código de subcategoría (2) + asignación (3)</strong>; los combos llevan un <strong>2</strong> antes de la asignación. Ejemplo: 15 + 07 + 001 = 1507001.</small></p>
      {aviso && <p className="aviso">{aviso}</p>}
      {error && <p className="error">{error}</p>}

      {puedeEditar && (
        <form className="tarjeta fila" onSubmit={(e) => { e.preventDefault(); accion(async () => { const r = await productosApi.guardarCategoria(null, nueva); setNueva({ codigo: '', nombre: '' }); setAviso(r.bsale?.activo ? (r.bsale.ok ? `Categoría creada ✔ · Bsale: ${r.bsale.mensaje}` : `Categoría creada ✔ · ⚠ Bsale: ${r.bsale.mensaje}`) : 'Categoría creada ✔'); }); }}>
          <strong>Nueva categoría</strong>
          <input required pattern="\d{2}" maxLength={2} placeholder="Código (2 dígitos)" value={nueva.codigo} onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })} />
          <input required className="crece" placeholder="Nombre" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} />
          <button>Agregar</button>
        </form>
      )}

      {matriz.map((c) => (
        <details key={c.id} className={`tarjeta matriz-cat ${c.activo ? '' : 'inactivo'}`}>
          <summary>
            <code>{c.codigo}</code> <strong>{c.nombre}</strong> <small>{c.subcategorias.length} subcategorías</small>
            {!c.activo && <small className="error">inactiva</small>}
            {bsale?.activo && bsale.leido && (bsale.categorias[c.id]
              ? <small className="chip-franja">Bsale ✔</small>
              : <small className="error">no está en Bsale{puedeEditar && <> · <button type="button" className="btn-link-oscuro" onClick={(e) => { e.preventDefault(); accion(async () => { const [r] = await bsaleApi.categorias([c.id]); setAviso(r.ok ? `${c.nombre}: creada en Bsale ✔` : `⚠ Bsale: ${r.mensaje}`); setBsale(await bsaleApi.estadoCatalogo()); }); }}>crear en Bsale</button></>}</small>)}
          </summary>
          <table>
            <thead><tr><th>Código</th><th>Subcategoría</th><th>SKU desde</th><th>Productos</th><th>Estado</th>{puedeEditar && <th />}</tr></thead>
            <tbody>
              {c.subcategorias.map((s) => (
                <tr key={s.id} className={s.activo ? '' : 'inactivo'}>
                  <td><code>{s.codigo}</code></td><td>{s.nombre}</td>
                  <td><code>{c.codigo}{s.codigo}001</code></td>
                  <td>{s.productos}</td>
                  <td>{s.activo ? 'Activa' : 'Inactiva'}</td>
                  {puedeEditar && (
                    <td className="acciones">
                      <button className="btn-mini btn-sec" onClick={() => renombrar('sub', s)}>Renombrar</button>
                      <button className="btn-mini btn-sec" onClick={() => accion(() => productosApi.guardarSubcategoria(s.id, { activo: !s.activo }))}>{s.activo ? 'Desactivar' : 'Activar'}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {puedeEditar && (
            <div className="fila" style={{ margin: '0 12px 12px' }}>
              <input pattern="\d{2}" maxLength={2} placeholder="Código" value={nuevaSub[c.id]?.codigo ?? ''}
                onChange={(e) => setNuevaSub({ ...nuevaSub, [c.id]: { ...nuevaSub[c.id], codigo: e.target.value } })} />
              <input className="crece" placeholder="Nueva subcategoría" value={nuevaSub[c.id]?.nombre ?? ''}
                onChange={(e) => setNuevaSub({ ...nuevaSub, [c.id]: { ...nuevaSub[c.id], nombre: e.target.value } })} />
              <button className="btn-sec" disabled={!nuevaSub[c.id]?.codigo || !nuevaSub[c.id]?.nombre}
                onClick={() => accion(async () => { await productosApi.guardarSubcategoria(null, { categoria_id: c.id, ...nuevaSub[c.id] }); setNuevaSub({ ...nuevaSub, [c.id]: {} }); })}>Agregar subcategoría</button>
              <button className="btn-sec" onClick={() => renombrar('cat', c)}>Renombrar categoría</button>
              <button className="btn-sec" onClick={() => accion(() => productosApi.guardarCategoria(c.id, { activo: !c.activo }))}>{c.activo ? 'Desactivar categoría' : 'Activar categoría'}</button>
            </div>
          )}
        </details>
      ))}
    </>
  );
}
