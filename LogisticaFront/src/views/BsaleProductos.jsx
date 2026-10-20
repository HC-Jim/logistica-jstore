'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { bsaleApi } from '../api/services';
import { fechaHora, soles } from '../utils/format';

const PESTANAS = [
  ['faltan', 'SKU que faltan en Bsale'], ['observaciones', 'Observaciones'], ['soloBsale', 'Solo en Bsale'],
  ['categorias', 'Categorías'], ['marcas', 'Marcas'], ['registro', 'Registro de envíos'],
];
const CLASES = { 0: 'Producto', 1: 'Servicio', 3: 'Pack' };

/** Productos ↔ Bsale: qué SKU, categorías y marcas faltan de cada lado, observaciones y creación en Bsale. */
export default function BsaleProductos() {
  const [estado, setEstado] = useState(null);
  const [d, setD] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [pestana, setPestana] = useState('faltan');
  const [busqueda, setBusqueda] = useState('');
  const [filtroObs, setFiltroObs] = useState('');
  const [marcados, setMarcados] = useState(new Set());
  const [progreso, setProgreso] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  async function cargar() {
    try {
      const [e, c, r] = await Promise.all([bsaleApi.estado(), bsaleApi.catalogo(), bsaleApi.envios()]);
      setEstado(e);
      setD(c);
      setEnvios(r.filter((x) => ['crear', 'nombre', 'ficha', 'categoria'].includes(x.tipo)));
    } catch (err) {
      setError(mensajeError(err));
    }
  }
  useEffect(() => { cargar(); }, []);
  useEffect(() => { setMarcados(new Set()); setBusqueda(''); setFiltroObs(''); }, [pestana]);

  async function tarea(fn) {
    setError('');
    setAviso('');
    try {
      const m = await fn();
      if (m) setAviso(m);
      await cargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setProgreso('');
    }
  }

  const leer = () => tarea(async () => {
    setProgreso('Leyendo listas…');
    const { pasos } = await bsaleApi.leer('listas');
    for (const [i, paso] of pasos.slice(1).entries()) {
      setProgreso(`Leyendo Bsale: paso ${i + 2} de ${pasos.length}…`);
      await bsaleApi.leer(paso);
    }
    return 'Bsale leído ✔';
  });

  const resumir = (res, que) => {
    const mal = res.filter((r) => !r.ok);
    return `${res.length - mal.length} ${que}${mal.length ? ` · ${mal.length} con error: ${mal.slice(0, 3).map((m) => `${m.sku ?? m.categoria} (${m.mensaje})`).join('; ')}` : ' ✔'}`;
  };

  const crearSkus = (ids) => tarea(async () => {
    if (!window.confirm(`Se crearán ${ids.length} SKU en Bsale (los combos como pack) con su categoría, marca y precios. ¿Continuar?`)) return null;
    const res = [];
    for (let i = 0; i < ids.length; i += 10) {
      setProgreso(`Creando en Bsale… ${i} de ${ids.length}`);
      res.push(...(await bsaleApi.crear(ids.slice(i, i + 10))));
    }
    return resumir(res, 'SKU creados o ya existentes en Bsale');
  });

  const corregir = (ids) => tarea(async () => {
    if (!window.confirm(`Se actualizará en Bsale el nombre, la categoría y la marca de ${ids.length} SKU con los datos del sistema. ¿Continuar?`)) return null;
    const res = [];
    for (let i = 0; i < ids.length; i += 40) {
      setProgreso(`Actualizando en Bsale… ${i} de ${ids.length}`);
      res.push(...(await bsaleApi.fichas(ids.slice(i, i + 40))));
    }
    return resumir(res, 'SKU actualizados en Bsale');
  });

  const crearCategorias = (ids) => tarea(async () => {
    if (!window.confirm(`Se crearán ${ids.length} categoría(s) en Bsale como tipo de producto. ¿Continuar?`)) return null;
    return resumir(await bsaleApi.categorias(ids), 'categorías creadas en Bsale');
  });

  const q = busqueda.trim().toLowerCase();
  const coincide = (...c) => !q || c.some((x) => String(x ?? '').toLowerCase().includes(q));
  const faltan = useMemo(() => (d?.soloSistema ?? []).filter((p) => coincide(p.sku, p.descripcion, p.categoria, p.marca, p.tipo)), [d, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const tiposObs = useMemo(() => [...new Set((d?.observaciones ?? []).flatMap((o) => o.observaciones.map((x) => x.split(':')[0])))], [d]);
  const obs = useMemo(() => (d?.observaciones ?? []).filter((o) => coincide(o.sku, o.descripcion, ...o.observaciones)
    && (!filtroObs || o.observaciones.some((x) => x.startsWith(filtroObs)))), [d, q, filtroObs]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcar = (id) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const marcarTodos = (ids) => setMarcados((m) => (ids.length && ids.every((i) => m.has(i)) ? new Set() : new Set(ids)));
  const sel = [...marcados];

  if (error && !d) return <p className="error">{error}</p>;
  if (!d || !estado) return <p>Cargando comparación con Bsale…</p>;
  const r = d.resumen;
  const sinLeer = !estado.lectura?.productos;
  const ocupado = Boolean(progreso);
  const Check = ({ ids }) => <input type="checkbox" title="Marcar todos" checked={ids.length > 0 && ids.every((i) => marcados.has(i))} onChange={() => marcarTodos(ids)} />;

  return (
    <>
      <div className="encabezado">
        <h2>Productos en Bsale</h2>
        <div className="fila">
          <small>{sinLeer ? 'Aún no se ha leído Bsale' : `Última lectura: ${fechaHora(estado.lectura.productos)}`}</small>
          <button onClick={leer} disabled={ocupado || !estado.activo}>⟳ Leer Bsale</button>
        </div>
      </div>
      {!estado.activo && <p className="aviso">Falta configurar <code>BSALE_ACCESS_TOKEN</code> en el servidor.</p>}
      {progreso && <p className="aviso">⏳ {progreso}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      {error && <p className="error">{error}</p>}
      <p><small>Precios y listas de precio: <Link href="/precios/bsale">Precios → Bsale</Link>. Al crear en el sistema un SKU, un combo (con sus componentes) o una categoría, también se crea en Bsale.</small></p>

      {!sinLeer && (
        <div className="kpis">
          <button className={`tarjeta kpi ${r.skus_faltan ? 'kpi-alerta' : ''}`} onClick={() => setPestana('faltan')}><small>SKU que faltan en Bsale</small><strong>{r.skus_faltan}</strong><small>{r.skus_en_ambos} en ambos</small></button>
          <button className={`tarjeta kpi ${r.observaciones ? 'kpi-alerta' : ''}`} onClick={() => setPestana('observaciones')}><small>SKU con observaciones</small><strong>{r.observaciones}</strong><small>{r.conflictos} en conflicto</small></button>
          <button className="tarjeta kpi" onClick={() => setPestana('soloBsale')}><small>Solo en Bsale</small><strong>{r.skus_solo_bsale}</strong></button>
          <button className={`tarjeta kpi ${r.categorias_faltan ? 'kpi-alerta' : ''}`} onClick={() => setPestana('categorias')}><small>Categorías que faltan en Bsale</small><strong>{r.categorias_faltan}</strong><small>{r.categorias_en_ambos} en ambos · {r.tipos_solo_bsale} solo en Bsale</small></button>
          <button className={`tarjeta kpi ${r.marcas_pendientes ? 'kpi-alerta' : ''}`} onClick={() => setPestana('marcas')}><small>Marcas pendientes en Bsale</small><strong>{r.marcas_pendientes}</strong><small>{r.marcas_en_bsale} identificadas</small></button>
        </div>
      )}

      {!sinLeer && (
        <section className="tarjeta">
          <div className="pestanas">
            {PESTANAS.map(([k, t]) => <button key={k} className={pestana === k ? 'activo' : ''} onClick={() => setPestana(k)}>{t}</button>)}
          </div>

          {['faltan', 'observaciones'].includes(pestana) && (
            <div className="fila filtros">
              <input className="crece" placeholder="Buscar SKU, nombre, categoría, marca…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              {pestana === 'observaciones' && (
                <select value={filtroObs} onChange={(e) => setFiltroObs(e.target.value)}>
                  <option value="">Todas las observaciones</option>
                  {tiposObs.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              {pestana === 'faltan' && <button onClick={() => crearSkus(sel)} disabled={ocupado || !sel.length}>Crear en Bsale ({sel.length})</button>}
              {pestana === 'observaciones' && <button onClick={() => corregir(sel)} disabled={ocupado || !sel.length}>Corregir en Bsale ({sel.length})</button>}
            </div>
          )}

          {pestana === 'faltan' && (
            <div className="tabla-scroll alto-limitado">
              <table>
                <thead><tr><th><Check ids={faltan.filter((p) => p.tipo !== 'Combo' || p.componentes).map((p) => p.id)} /></th><th>SKU</th><th>Producto</th><th>Tipo</th><th>Categoría</th><th>Marca</th><th className="num">Precio Web</th></tr></thead>
                <tbody>
                  {faltan.slice(0, 1500).map((p) => {
                    const sinComp = p.tipo === 'Combo' && !p.componentes;
                    return (
                      <tr key={p.id}>
                        <td><input type="checkbox" disabled={sinComp} checked={marcados.has(p.id)} onChange={() => marcar(p.id)} /></td>
                        <td><Link href={`/productos/${p.id}`}>{p.sku}</Link></td>
                        <td>{p.descripcion}{sinComp && <small className="error">combo sin componentes</small>}</td>
                        <td>{p.tipo}{p.tipo === 'Combo' && p.componentes > 0 && <small>{p.componentes} componentes</small>}</td>
                        <td>{p.categoria ?? <small>sin categoría</small>}</td><td>{p.marca ?? '—'}</td>
                        <td className="num">{p.precio ? soles(p.precio) : '—'}</td>
                      </tr>
                    );
                  })}
                  {!faltan.length && <tr><td colSpan={7}>Todos los SKU activos están en Bsale ✔</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {pestana === 'observaciones' && (
            <>
              <p><small>“Corregir en Bsale” pone en Bsale el nombre, la categoría y la marca del sistema. Los SKU en conflicto (otro producto en Bsale) no se pueden corregir desde aquí.</small></p>
              <div className="tabla-scroll alto-limitado">
                <table>
                  <thead><tr><th><Check ids={obs.filter((o) => !o.conflicto).map((o) => o.id)} /></th><th>SKU</th><th>En el sistema</th><th>Observaciones</th></tr></thead>
                  <tbody>
                    {obs.slice(0, 1500).map((o) => (
                      <tr key={o.id}>
                        <td><input type="checkbox" disabled={o.conflicto} checked={marcados.has(o.id)} onChange={() => marcar(o.id)} /></td>
                        <td><Link href={`/productos/${o.id}`}>{o.sku}</Link></td>
                        <td>{o.descripcion}<small>{[o.categoria, o.marca].filter(Boolean).join(' · ')}</small></td>
                        <td>{o.observaciones.map((x) => <div key={x} className={o.conflicto && x.startsWith('Otro') ? 'error' : ''}><small>• {x}</small></div>)}</td>
                      </tr>
                    ))}
                    {!obs.length && <tr><td colSpan={4}>Sin observaciones ✔</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {pestana === 'soloBsale' && (
            <table>
              <thead><tr><th>Código</th><th>Nombre en Bsale</th><th>Clase</th><th>Tipo (categoría)</th></tr></thead>
              <tbody>
                {d.soloBsale.map((p) => <tr key={p.id}><td>{p.codigo}</td><td>{p.nombre}</td><td>{CLASES[p.clasificacion] ?? '—'}</td><td>{p.tipo ?? '—'}</td></tr>)}
                {!d.soloBsale.length && <tr><td colSpan={4}>Todo lo de Bsale está en el sistema ✔</td></tr>}
              </tbody>
            </table>
          )}

          {pestana === 'categorias' && (
            <>
              <div className="fila"><button onClick={() => crearCategorias(sel)} disabled={ocupado || !sel.length}>Crear en Bsale ({sel.length})</button></div>
              <table>
                <thead><tr><th><Check ids={d.categorias.filter((c) => !c.bsale && c.activo).map((c) => c.id)} /></th><th>Código</th><th>Categoría del sistema</th><th className="num">SKU activos</th><th>En Bsale</th><th className="num">Productos en Bsale</th></tr></thead>
                <tbody>
                  {d.categorias.map((c) => (
                    <tr key={c.id}>
                      <td><input type="checkbox" disabled={Boolean(c.bsale) || !c.activo} checked={marcados.has(c.id)} onChange={() => marcar(c.id)} /></td>
                      <td>{c.codigo}</td><td>{c.nombre}{!c.activo && <small>inactiva</small>}</td><td className="num">{c.skus}</td>
                      <td>{c.bsale ? '✔' : <span className="error">Falta</span>}</td>
                      <td className="num">{c.bsale?.productos ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Tipos de producto que solo están en Bsale</h3>
              <p><small>Suelen ser las categorías antiguas. Si ya no se usan, se pueden desactivar en Bsale.</small></p>
              <table>
                <thead><tr><th>Tipo en Bsale</th><th className="num">Productos</th><th>Estado</th></tr></thead>
                <tbody>
                  {d.tiposSoloBsale.map((t) => <tr key={t.id}><td>{t.nombre}</td><td className="num">{t.productos}</td><td>{t.activo ? 'Activo' : 'Inactivo'}</td></tr>)}
                  {!d.tiposSoloBsale.length && <tr><td colSpan={3}>Ninguno ✔</td></tr>}
                </tbody>
              </table>
            </>
          )}

          {pestana === 'marcas' && (
            <>
              <p className="aviso">La API de Bsale no permite leer ni crear marcas: solo indica el número de marca de cada producto. El nombre se deduce de los SKU que están en ambos lados. Las marcas pendientes hay que crearlas a mano en Bsale y luego volver a leer.</p>
              <table>
                <thead><tr><th>Marca del sistema</th><th className="num">SKU activos</th><th>En Bsale</th></tr></thead>
                <tbody>
                  {d.marcas.filter((m) => m.activo).map((m) => (
                    <tr key={m.id}>
                      <td>{m.nombre}{m.propia && <small>propia</small>}</td><td className="num">{m.skus}</td>
                      <td>{m.bsale_id ? `✔ marca n.º ${m.bsale_id}` : m.skus ? <span className="error">Pendiente</span> : <small>sin SKU activos</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.marcasBsale.some((m) => !m.nombre) && (
                <>
                  <h3>Marcas de Bsale sin identificar</h3>
                  <p><small>Números de marca usados solo por productos que no están en el sistema.</small></p>
                  <table>
                    <thead><tr><th>Marca n.º</th><th className="num">Productos en Bsale</th></tr></thead>
                    <tbody>{d.marcasBsale.filter((m) => !m.nombre).map((m) => <tr key={m.bsale_id}><td>{m.bsale_id}</td><td className="num">{m.productos}</td></tr>)}</tbody>
                  </table>
                </>
              )}
            </>
          )}

          {pestana === 'registro' && (
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>SKU / código</th><th>Resultado</th><th>Usuario</th></tr></thead>
              <tbody>
                {envios.map((e) => (
                  <tr key={e.id}>
                    <td><small>{fechaHora(e.creado_en)}</small></td>
                    <td>{{ crear: 'Creación', nombre: 'Nombre', ficha: 'Ficha', categoria: 'Categoría' }[e.tipo]}</td>
                    <td>{e.sku}</td>
                    <td>{e.ok ? '✔' : <span className="error">✘ {e.error}</span>}</td>
                    <td><small>{e.usuario ?? '—'}</small></td>
                  </tr>
                ))}
                {!envios.length && <tr><td colSpan={5}>Aún no se ha enviado nada a Bsale.</td></tr>}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
