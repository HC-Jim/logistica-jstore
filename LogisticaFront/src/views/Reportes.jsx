'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { reportesApi } from '../api/services';
import { descargarCsv } from '../utils/csv';
import { duracion, fechaCorta, fechaHora, hoyISO, soles } from '../utils/format';

const ICONOS = {
  pedidos: '📦', bsale: '🧾', productos: '🏷️', variacion_precio: '💲', rutas: '🗺️',
  recorrido: '🛰️', flota: '🚚', incidencias: '⚠️', inversa: '↩️', usuarios: '👥',
};

/** Texto de una celda según el tipo de columna (en pantalla y en el CSV). */
function formato(tipo, v) {
  if (v == null || v === '') return '';
  switch (tipo) {
    case 'monto': return soles(Number(v));
    case 'km': return `${Number(v).toFixed(1)} km`;
    case 'pct': return `${Number(v).toFixed(1)} %`;
    case 'fecha': return fechaCorta(String(v).slice(0, 10));
    case 'fechahora': return fechaHora(v);
    case 'duracion': return duracion(Number(v));
    default: return String(v);
  }
}

/** En el CSV los números van sin "S/" ni "%" para que Excel pueda sumarlos. */
function valorCsv(tipo, v) {
  if (v == null || v === '') return '';
  if (['monto', 'km', 'pct', 'entero'].includes(tipo)) return String(v);
  if (tipo === 'pedido') return v;
  return formato(tipo, v);
}

const inicioDeMes = () => `${hoyISO().slice(0, 8)}01`;

export default function Reportes() {
  const [lista, setLista] = useState([]);
  const [clave, setClave] = useState('pedidos');
  const [filtros, setFiltros] = useState({ desde: inicioDeMes(), hasta: hoyISO() });
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [orden, setOrden] = useState(null); // { clave, asc }
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => { reportesApi.listar().then(setLista).catch((e) => setError(mensajeError(e))); }, []);
  const reporte = lista.find((r) => r.clave === clave);

  useEffect(() => {
    setCargando(true);
    setError('');
    const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '' && v != null));
    reportesApi.ejecutar(clave, params)
      .then((d) => { setDatos(d); setOrden(null); })
      .catch((e) => { setError(mensajeError(e)); setDatos(null); })
      .finally(() => setCargando(false));
  }, [clave, filtros]);

  function elegir(c) {
    setClave(c);
    setBusqueda('');
    setFiltros((f) => ({ desde: f.desde, hasta: f.hasta })); // los filtros propios no pasan de un reporte a otro
  }

  const filas = useMemo(() => {
    if (!datos) return [];
    const q = busqueda.trim().toLowerCase();
    let r = q ? datos.filas.filter((f) => Object.values(f).some((v) => v != null && String(v).toLowerCase().includes(q))) : datos.filas;
    if (orden) {
      const c = orden.clave;
      r = [...r].sort((a, b) => {
        const x = a[c], y = b[c];
        if (x == null) return 1;
        if (y == null) return -1;
        const cmp = typeof x === 'number' || !Number.isNaN(Number(x)) && !Number.isNaN(Number(y))
          ? Number(x) - Number(y) : String(x).localeCompare(String(y), 'es');
        return orden.asc ? cmp : -cmp;
      });
    }
    return r;
  }, [datos, busqueda, orden]);

  function exportar() {
    descargarCsv(
      `reporte-${clave}-${datos.desde}-a-${datos.hasta}.csv`,
      datos.columnas.map((c) => ({ titulo: c.titulo, valor: (f) => valorCsv(c.tipo, f[c.clave]) })),
      filas
    );
  }

  return (
    <>
      <div className="encabezado"><h2>Reportes</h2></div>
      <div className="reportes">
        <nav className="tarjeta reportes-menu">
          {lista.map((r) => (
            <button key={r.clave} className={r.clave === clave ? 'activo' : ''} onClick={() => elegir(r.clave)}>
              <span>{ICONOS[r.clave]}</span> {r.titulo}
            </button>
          ))}
        </nav>

        <section className="tarjeta reportes-cuerpo">
          {reporte && (
            <>
              <h3>{ICONOS[clave]} {reporte.titulo}</h3>
              <p><small>{reporte.descripcion}</small></p>
            </>
          )}
          <div className="fila filtros">
            <label>Desde <input type="date" value={filtros.desde} max={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} /></label>
            <label>Hasta <input type="date" value={filtros.hasta} min={filtros.desde} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} /></label>
            {reporte?.filtros.map((f) => (f.check ? (
              <label key={f.clave} className="check">
                <input type="checkbox" checked={filtros[f.clave] === '1'} onChange={(e) => setFiltros({ ...filtros, [f.clave]: e.target.checked ? '1' : '' })} /> {f.etiqueta}
              </label>
            ) : (
              <select key={f.clave} value={filtros[f.clave] ?? ''} onChange={(e) => setFiltros({ ...filtros, [f.clave]: e.target.value })}>
                <option value="">{f.etiqueta}: todos</option>
                {f.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )))}
            <input className="crece" placeholder="Buscar en el resultado…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            <button className="btn-sec" onClick={exportar} disabled={!filas.length}>⬇ Excel (CSV)</button>
          </div>

          {error && <p className="error">{error}</p>}
          {cargando && <p>Cargando…</p>}
          {datos && !cargando && (
            <>
              <div className="resumen-reporte">
                {datos.resumen.map((r) => (
                  <div key={r.etiqueta} className={r.alerta ? 'alerta' : ''}>
                    <strong>{r.tipo ? formato(r.tipo, r.valor) || '—' : r.valor}</strong>
                    <small>{r.etiqueta}</small>
                  </div>
                ))}
              </div>
              <div className="tabla-scroll">
                <table className="tabla-reporte">
                  <thead>
                    <tr>
                      {datos.columnas.map((c) => (
                        <th key={c.clave} className={['monto', 'km', 'pct', 'entero'].includes(c.tipo) ? 'num' : ''}
                          onClick={() => setOrden((o) => ({ clave: c.clave, asc: o?.clave === c.clave ? !o.asc : true }))}>
                          {c.titulo}{orden?.clave === c.clave ? (orden.asc ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => (
                      <tr key={i}>
                        {datos.columnas.map((c) => (
                          <td key={c.clave} className={['monto', 'km', 'pct', 'entero'].includes(c.tipo) ? 'num' : ''}>
                            {c.tipo === 'pedido' && f[c.clave] ? <Link href={`/pedidos/${f[c.clave]}`}>{f[c.clave]}</Link> : formato(c.tipo, f[c.clave])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!filas.length && <tr><td colSpan={datos.columnas.length}>Sin resultados para este periodo.</td></tr>}
                  </tbody>
                </table>
              </div>
              <small>{filas.length} fila(s){busqueda && ` de ${datos.filas.length}`}</small>
            </>
          )}
        </section>
      </div>
    </>
  );
}
