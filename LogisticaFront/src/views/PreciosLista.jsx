'use client';

import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { preciosApi, productosApi } from '../api/services';
import { descargarCsv } from '../utils/csv';
import { fechaCorta, soles } from '../utils/format';

/** Lista de precios: precio vigente de cada SKU en cada plataforma. */
export default function PreciosLista() {
  const [plataformas, setPlataformas] = useState([]);
  const [filas, setFilas] = useState(null);
  const [matriz, setMatriz] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [filtros, setFiltros] = useState({ q: '', categoria_id: '', marca_id: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    preciosApi.plataformas().then((p) => setPlataformas(p.filter((x) => x.activo))).catch(() => {});
    productosApi.matriz().then(setMatriz).catch(() => {});
    productosApi.marcas().then(setMarcas).catch(() => {});
  }, []);

  const params = useMemo(() => Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '')), [filtros]);
  useEffect(() => {
    const t = setTimeout(() => {
      setFilas(null);
      preciosApi.vigentes(params).then(setFilas).catch((e) => setError(mensajeError(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [params]);

  const f = (campo) => ({ value: filtros[campo], onChange: (e) => setFiltros({ ...filtros, [campo]: e.target.value }) });

  function exportar() {
    descargarCsv('lista-de-precios.csv', [
      { titulo: 'SKU', valor: (r) => r.sku }, { titulo: 'Producto', valor: (r) => r.descripcion },
      { titulo: 'Marca', valor: (r) => r.marca }, { titulo: 'Precio Normal', valor: (r) => r.precio_normal },
      ...plataformas.map((p) => ({ titulo: p.nombre, valor: (r) => r.precios[p.nombre]?.precio ?? '' })),
    ], filas ?? []);
  }

  return (
    <>
      <div className="encabezado">
        <h2>Lista de precios</h2>
        <button className="btn-sec" onClick={exportar} disabled={!filas?.length}>⬇ Excel (CSV)</button>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="tarjeta">
        <div className="fila filtros">
          <input className="crece" placeholder="Buscar por SKU o nombre…" {...f('q')} />
          <select {...f('categoria_id')}>
            <option value="">Todas las categorías</option>
            {matriz.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
          <select {...f('marca_id')}>
            <option value="">Todas las marcas</option>
            {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </div>
        {!filas ? <p>Cargando precios…</p> : (
          <>
            <p className="resumen-lista">{filas.length} SKU · precio vigente (último registrado) por plataforma; pasa el mouse para ver la fecha</p>
            <div className="tabla-scroll">
              <table className="tabla-reporte">
                <thead>
                  <tr><th>SKU</th><th>Producto</th><th className="num">P. Normal</th>{plataformas.map((p) => <th key={p.id} className="num">{p.nombre}</th>)}</tr>
                </thead>
                <tbody>
                  {filas.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.sku}</strong></td>
                      <td>{r.descripcion}{r.marca && <small>{r.marca}</small>}</td>
                      <td className="num tachado">{r.precio_normal != null ? soles(r.precio_normal) : '—'}</td>
                      {plataformas.map((p) => {
                        const v = r.precios[p.nombre];
                        return <td key={p.id} className="num" title={v ? `Desde el ${fechaCorta(v.fecha)}` : 'Sin precio'}>{v ? soles(v.precio) : '—'}</td>;
                      })}
                    </tr>
                  ))}
                  {!filas.length && <tr><td colSpan={3 + plataformas.length}>Sin resultados.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
