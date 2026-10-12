'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { productosApi } from '../api/services';

/** Ubica en la matriz nueva los productos que venían con la codificación antigua (el SKU no cambia). */
export default function Reclasificar() {
  const [grupos, setGrupos] = useState(null);
  const [matriz, setMatriz] = useState([]);
  const [eleccion, setEleccion] = useState({});
  const [verTodos, setVerTodos] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = () => productosApi.gruposAnteriores().then(setGrupos).catch((e) => setError(mensajeError(e)));
  useEffect(() => {
    cargar();
    productosApi.matriz().then(setMatriz).catch(() => {});
  }, []);

  const clave = (g) => `${g.categoria_anterior}|${g.subcategoria_anterior}`;
  async function aplicar(g) {
    setError('');
    try {
      const r = await productosApi.reclasificar({ categoria_anterior: g.categoria_anterior, subcategoria_anterior: g.subcategoria_anterior, subcategoria_id: Number(eleccion[clave(g)]) });
      setAviso(`${r.actualizados} producto(s) de "${g.categoria_anterior} / ${g.subcategoria_anterior}" ubicados ✔`);
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  const visibles = (grupos ?? []).filter((g) => verTodos || g.pendientes > 0);
  const pendientes = (grupos ?? []).reduce((s, g) => s + g.pendientes, 0);
  const nombreSub = (id) => {
    for (const c of matriz) { const s = c.subcategorias.find((x) => x.id === id); if (s) return `${c.codigo}${s.codigo} · ${c.nombre} / ${s.nombre}`; }
    return '';
  };

  return (
    <>
      <h2>Reclasificar productos</h2>
      <p><small>Estos productos vienen con la <strong>codificación antigua</strong> de categorías. Elige su subcategoría en la matriz nueva: se aplica a todo el grupo. <strong>El SKU no cambia.</strong></small></p>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      {!grupos ? <p>Cargando…</p> : (
        <section className="tarjeta">
          <div className="fila espacio">
            <strong>{pendientes} producto(s) por ubicar en {grupos.filter((g) => g.pendientes).length} grupos</strong>
            <label className="check"><input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver también los ya ubicados</label>
          </div>
          <table>
            <thead><tr><th>Categoría / subcategoría antigua</th><th className="num">Productos</th><th>Ejemplos</th><th>Subcategoría nueva</th><th /></tr></thead>
            <tbody>
              {visibles.map((g) => (
                <tr key={clave(g)}>
                  <td><strong>{g.categoria_anterior ?? '—'}</strong><small>{g.subcategoria_anterior ?? '—'}</small></td>
                  <td className="num">{g.total}{g.pendientes > 0 && g.pendientes < g.total && <small>{g.pendientes} pendientes</small>}</td>
                  <td><small>{g.ejemplos.join(' · ')}</small></td>
                  <td>
                    {g.pendientes === 0 && !eleccion[clave(g)] && <small>✔ {nombreSub(g.subcategoria_id)}</small>}
                    <select value={eleccion[clave(g)] ?? ''} onChange={(e) => setEleccion({ ...eleccion, [clave(g)]: e.target.value })}>
                      <option value="">{g.pendientes ? 'Elige…' : 'Cambiar…'}</option>
                      {matriz.map((c) => (
                        <optgroup key={c.id} label={`${c.codigo} · ${c.nombre}`}>
                          {c.subcategorias.filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{c.codigo}{s.codigo} · {s.nombre}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td><button disabled={!eleccion[clave(g)]} onClick={() => aplicar(g)}>Aplicar</button></td>
                </tr>
              ))}
              {!visibles.length && <tr><td colSpan={5}>✔ Todos los productos están ubicados en la matriz nueva.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
