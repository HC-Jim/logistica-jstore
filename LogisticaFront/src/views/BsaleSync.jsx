'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { bsaleApi, preciosApi } from '../api/services';
import { fechaHora, soles } from '../utils/format';

const FUENTES = [
  { valor: 'minimo_plataformas', texto: 'Precio más bajo de las plataformas (sin Web)' },
  { valor: 'normal', texto: 'Precio normal' },
  { valor: 'ninguna', texto: 'No sincronizar' },
];
const PESTANAS = [
  ['precios', 'Precios distintos'], ['crear', 'SKU que faltan en Bsale'], ['nombres', 'Nombres distintos'],
  ['conflictos', 'SKU en conflicto'], ['soloBsale', 'Solo en Bsale'], ['registro', 'Registro de envíos'],
];

/** Compara el catálogo y los precios con Bsale y envía lo que falta. */
export default function BsaleSync() {
  const [estado, setEstado] = useState(null);
  const [plataformas, setPlataformas] = useState([]);
  const [listas, setListas] = useState([]);
  const [dif, setDif] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [pestana, setPestana] = useState('precios');
  const [progreso, setProgreso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [marcados, setMarcados] = useState(new Set());

  async function cargar() {
    try {
      const [e, d, r] = await Promise.all([bsaleApi.estado(), bsaleApi.diferencias(), bsaleApi.envios()]);
      setEstado(e);
      setListas(e.listas.map((l) => ({ ...l })));
      setDif(d);
      setEnvios(r);
    } catch (err) {
      setError(mensajeError(err));
    }
  }
  useEffect(() => {
    cargar();
    preciosApi.plataformas().then((p) => setPlataformas(p.filter((x) => x.activo))).catch(() => {});
  }, []);
  useEffect(() => { setMarcados(new Set()); setBusqueda(''); }, [pestana]);

  /** Ejecuta una tarea larga mostrando el avance; al terminar recarga las diferencias. */
  async function tarea(fn) {
    setOcupado(true);
    setError('');
    setAviso('');
    try {
      const mensaje = await fn();
      if (mensaje) setAviso(mensaje);
      await cargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado(false);
      setProgreso('');
    }
  }

  const leer = () => tarea(async () => {
    setProgreso('Leyendo listas de precio…');
    const { pasos } = await bsaleApi.leer('listas');
    const nombres = Object.fromEntries((estado?.listas ?? []).map((l) => [`lista:${l.id}`, l.nombre]));
    for (const [i, paso] of pasos.slice(1).entries()) {
      setProgreso(`Paso ${i + 2} de ${pasos.length}: ${{ productos: 'productos', stock: 'stock por sucursal' }[paso] ?? nombres[paso] ?? paso}…`);
      await bsaleApi.leer(paso);
    }
    return 'Bsale leído ✔';
  });

  const guardarListas = () => tarea(async () => {
    await bsaleApi.guardarListas(listas.map((l) => ({ id: l.id, fuente: l.fuente, plataforma_id: l.fuente === 'plataforma' ? l.plataforma_id : null })));
    return 'Fuentes de precio guardadas ✔';
  });

  /** Envía precios en tandas (el servidor procesa unas 25 por llamada). */
  const enviarPrecios = (ids) => tarea(async () => {
    const total = ids ? filasPrecios.filter((p) => ids.includes(p.producto_id)).length : dif.precios.length;
    if (!window.confirm(`Se actualizarán ${total} precio(s) en Bsale. ¿Continuar?`)) return null;
    let enviados = 0;
    let errores = 0;
    for (let vuelta = 0; vuelta < 200; vuelta++) {
      setProgreso(`Enviando precios a Bsale… ${enviados} de ${total}`);
      const r = await bsaleApi.enviarPrecios(ids);
      enviados += r.enviados;
      errores = r.errores;
      if (!r.pendientes || (r.enviados === 0 && r.errores)) break;
    }
    return `${enviados} precio(s) actualizados en Bsale${errores ? ` · ${errores} con error (ver Registro de envíos)` : ' ✔'}`;
  });

  const crear = (ids) => tarea(async () => {
    if (!window.confirm(`Se crearán ${ids.length} SKU en Bsale (producto y variante) con sus precios. ¿Continuar?`)) return null;
    const res = [];
    for (let i = 0; i < ids.length; i += 10) {
      setProgreso(`Creando en Bsale… ${i} de ${ids.length}`);
      res.push(...(await bsaleApi.crear(ids.slice(i, i + 10))));
    }
    const mal = res.filter((r) => !r.ok);
    return `${res.length - mal.length} SKU creados o ya existentes en Bsale${mal.length ? ` · ${mal.length} con error: ${mal.slice(0, 3).map((m) => `${m.sku} (${m.mensaje})`).join('; ')}` : ' ✔'}`;
  });

  const actualizarNombres = (ids) => tarea(async () => {
    if (!window.confirm(`Se cambiará el nombre de ${ids.length} producto(s) en Bsale por el del sistema. ¿Continuar?`)) return null;
    const res = [];
    for (let i = 0; i < ids.length; i += 40) res.push(...(await bsaleApi.nombres(ids.slice(i, i + 40))));
    const mal = res.filter((r) => !r.ok);
    return `${res.length - mal.length} nombre(s) actualizados${mal.length ? ` · ${mal.length} con error` : ' ✔'}`;
  });

  const q = busqueda.trim().toLowerCase();
  const filtra = (...campos) => !q || campos.some((c) => String(c ?? '').toLowerCase().includes(q));
  const filasPrecios = useMemo(() => (dif?.precios ?? []).filter((p) => filtra(p.sku, p.descripcion, p.lista)), [dif, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const filasCrear = useMemo(() => (dif?.soloSistema ?? []).filter((p) => filtra(p.sku, p.descripcion, p.categoria, p.tipo)), [dif, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const filasNombres = useMemo(() => (dif?.nombres ?? []).filter((p) => filtra(p.sku, p.descripcion, p.nombre_bsale)), [dif, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const marcar = (id) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const marcarTodos = (ids) => setMarcados((m) => (ids.every((i) => m.has(i)) ? new Set() : new Set(ids)));
  const seleccion = [...marcados];

  if (error && !estado) return <p className="error">{error}</p>;
  if (!estado) return <p>Cargando…</p>;
  const r = dif?.resumen;
  const sinLeer = !estado.lectura?.productos;

  return (
    <>
      <div className="encabezado">
        <h2>Sincronización con Bsale</h2>
        <div className="fila">
          <small>{sinLeer ? 'Aún no se ha leído Bsale' : `Última lectura: ${fechaHora(estado.lectura.productos)}`}</small>
          <button onClick={leer} disabled={ocupado || !estado.activo}>⟳ Leer Bsale</button>
        </div>
      </div>
      {!estado.activo && <p className="aviso">Falta configurar <code>BSALE_ACCESS_TOKEN</code> en el servidor (Vercel → logistica-api → Environment Variables).</p>}
      {progreso && <p className="aviso">⏳ {progreso}</p>}
      {aviso && <p className="aviso">{aviso}</p>}
      {error && <p className="error">{error}</p>}

      <section className="tarjeta">
        <h3>Listas de precio de Bsale</h3>
        <p><small>Cada lista toma su precio de una fuente del sistema. Al registrar un precio en <Link href="/precios">Consultar precio</Link> se actualiza en Bsale en el momento.</small></p>
        <table>
          <thead><tr><th>Lista en Bsale</th><th>Toma el precio de</th><th className="num">Precios leídos</th></tr></thead>
          <tbody>
            {listas.filter((l) => l.activa).map((l) => (
              <tr key={l.id}>
                <td><strong>{l.nombre}</strong></td>
                <td>
                  <select value={l.fuente === 'plataforma' ? `p:${l.plataforma_id}` : l.fuente} disabled={ocupado}
                    onChange={(e) => {
                      const v = e.target.value;
                      setListas((ls) => ls.map((x) => (x.id !== l.id ? x : v.startsWith('p:')
                        ? { ...x, fuente: 'plataforma', plataforma_id: Number(v.slice(2)) } : { ...x, fuente: v, plataforma_id: null })));
                    }}>
                    {plataformas.map((p) => <option key={p.id} value={`p:${p.id}`}>Plataforma {p.nombre}</option>)}
                    {FUENTES.map((f) => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
                  </select>
                </td>
                <td className="num">{l.precios}</td>
              </tr>
            ))}
            {!listas.length && <tr><td colSpan={3}>Pulsa “Leer Bsale” para traer las listas de precio.</td></tr>}
          </tbody>
        </table>
        {listas.length > 0 && <div className="fila"><button className="btn-sec" onClick={guardarListas} disabled={ocupado}>Guardar fuentes</button></div>}
      </section>

      {r && !sinLeer && (
        <div className="kpis">
          <div className="tarjeta kpi"><small>SKU en ambos</small><strong>{r.en_ambos}</strong><small>{r.con_stock} con stock en Bsale</small></div>
          <button className={`tarjeta kpi ${r.productos_con_precio_distinto ? 'kpi-alerta' : ''}`} onClick={() => setPestana('precios')}><small>Productos con precio distinto</small><strong>{r.productos_con_precio_distinto}</strong><small>{r.precios_distintos} precio(s)</small></button>
          <button className={`tarjeta kpi ${r.solo_sistema ? 'kpi-alerta' : ''}`} onClick={() => setPestana('crear')}><small>SKU que faltan en Bsale</small><strong>{r.solo_sistema}</strong></button>
          <button className="tarjeta kpi" onClick={() => setPestana('nombres')}><small>Nombres distintos</small><strong>{r.nombres_distintos}</strong></button>
          <button className={`tarjeta kpi ${r.conflictos ? 'kpi-alerta' : ''}`} onClick={() => setPestana('conflictos')}><small>SKU en conflicto</small><strong>{r.conflictos}</strong><small>otro producto en Bsale</small></button>
          <button className="tarjeta kpi" onClick={() => setPestana('soloBsale')}><small>Solo en Bsale</small><strong>{r.solo_bsale}</strong></button>
        </div>
      )}

      {dif && !sinLeer && (
        <section className="tarjeta">
          <div className="pestanas">
            {PESTANAS.map(([k, t]) => <button key={k} className={pestana === k ? 'activo' : ''} onClick={() => setPestana(k)}>{t}</button>)}
          </div>
          {['precios', 'crear', 'nombres'].includes(pestana) && (
            <div className="fila filtros">
              <input className="crece" placeholder="Buscar SKU, nombre, lista…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              {pestana === 'precios' && <>
                <button onClick={() => enviarPrecios(null)} disabled={ocupado || !dif.precios.length}>Enviar todos ({dif.precios.length})</button>
                <button className="btn-sec" onClick={() => enviarPrecios(seleccion)} disabled={ocupado || !seleccion.length}>Enviar seleccionados ({seleccion.length})</button>
              </>}
              {pestana === 'crear' && <button onClick={() => crear(seleccion)} disabled={ocupado || !seleccion.length}>Crear en Bsale ({seleccion.length})</button>}
              {pestana === 'nombres' && <button onClick={() => actualizarNombres(seleccion)} disabled={ocupado || !seleccion.length}>Actualizar en Bsale ({seleccion.length})</button>}
            </div>
          )}

          {pestana === 'precios' && (
            <Tabla cabecera={['SKU', 'Producto', 'Lista', 'En Bsale', 'En el sistema']} ids={[...new Set(filasPrecios.map((p) => p.producto_id))]}
              marcados={marcados} marcarTodos={marcarTodos} vacio="Los precios de Bsale están al día ✔">
              {filasPrecios.slice(0, 1500).map((p) => (
                <tr key={`${p.producto_id}-${p.lista_id}`}>
                  <td><input type="checkbox" checked={marcados.has(p.producto_id)} onChange={() => marcar(p.producto_id)} /></td>
                  <td>{p.sku}</td><td>{p.descripcion}</td><td>{p.lista}</td>
                  <td className="num">{p.precio_bsale ? soles(p.precio_bsale) : <small>sin precio</small>}</td>
                  <td className="num"><strong>{soles(p.precio)}</strong></td>
                </tr>
              ))}
            </Tabla>
          )}
          {pestana === 'crear' && (
            <>
              <p><small>Se crea el producto en Bsale con su tipo según la categoría y la variante con el SKU; luego se le envían los precios de cada lista. Los combos se arman en Bsale como pack.</small></p>
              <Tabla cabecera={['SKU', 'Producto', 'Tipo', 'Categoría', 'Precio Web']} ids={filasCrear.filter((p) => p.tipo !== 'Combo').map((p) => p.id)}
                marcados={marcados} marcarTodos={marcarTodos} vacio="Todos los SKU activos existen en Bsale ✔">
                {filasCrear.slice(0, 1500).map((p) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" disabled={p.tipo === 'Combo'} checked={marcados.has(p.id)} onChange={() => marcar(p.id)} /></td>
                    <td><Link href={`/productos/${p.id}`}>{p.sku}</Link></td><td>{p.descripcion}</td><td>{p.tipo}</td><td>{p.categoria ?? '—'}</td>
                    <td className="num">{p.precio ? soles(p.precio) : '—'}</td>
                  </tr>
                ))}
              </Tabla>
            </>
          )}
          {pestana === 'nombres' && (
            <Tabla cabecera={['SKU', 'Nombre en Bsale', 'Nombre en el sistema']} ids={filasNombres.map((p) => p.id)} marcados={marcados} marcarTodos={marcarTodos} vacio="Los nombres coinciden ✔">
              {filasNombres.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" checked={marcados.has(p.id)} onChange={() => marcar(p.id)} /></td>
                  <td>{p.sku}</td><td>{p.nombre_bsale}</td><td><strong>{p.descripcion}</strong></td>
                </tr>
              ))}
            </Tabla>
          )}
          {pestana === 'conflictos' && (
            <>
              <p className="aviso">Estos SKU existen en Bsale pero corresponden a <strong>otro producto</strong>. No se les envían precios ni nombres para no cambiar el producto equivocado. Corrige el SKU en Bsale o en el sistema y vuelve a leer.</p>
              <table>
                <thead><tr><th>SKU</th><th>En Bsale</th><th>En el sistema</th></tr></thead>
                <tbody>
                  {dif.conflictos.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.nombre_bsale}</td><td><Link href={`/productos/${p.id}`}>{p.descripcion}</Link></td></tr>)}
                  {!dif.conflictos.length && <tr><td colSpan={3}>Sin conflictos ✔</td></tr>}
                </tbody>
              </table>
            </>
          )}
          {pestana === 'soloBsale' && (
            <table>
              <thead><tr><th>Código</th><th>Nombre en Bsale</th><th className="num">Stock</th></tr></thead>
              <tbody>
                {dif.soloBsale.map((p) => <tr key={p.id}><td>{p.codigo}</td><td>{p.nombre}</td><td className="num">{p.stock ?? 0}</td></tr>)}
                {!dif.soloBsale.length && <tr><td colSpan={3}>Todo lo de Bsale está en el sistema ✔</td></tr>}
              </tbody>
            </table>
          )}
          {pestana === 'registro' && (
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>SKU</th><th>Detalle</th><th>Usuario</th></tr></thead>
              <tbody>
                {envios.map((e) => (
                  <tr key={e.id}>
                    <td><small>{fechaHora(e.creado_en)}</small></td>
                    <td>{{ precio: 'Precio', crear: 'Creación', nombre: 'Nombre' }[e.tipo]}</td>
                    <td>{e.sku}</td>
                    <td>{e.ok ? '✔ ' : <span className="error">✘ {e.error}</span>}{e.ok && <small>{detalleEnvio(e)}</small>}</td>
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

function detalleEnvio(e) {
  if (e.tipo === 'precio') return (e.detalle ?? []).map((c) => `${c.lista}: ${c.antes ? soles(c.antes) : '—'} → ${soles(c.ahora)}`).join(' · ');
  if (e.tipo === 'nombre') return `"${e.detalle?.antes ?? ''}" → "${e.detalle?.ahora ?? ''}"`;
  if (e.tipo === 'crear') return `producto ${e.detalle?.producto_bsale} · ${e.detalle?.precios ?? 0} precio(s)`;
  return '';
}

function Tabla({ cabecera, ids, marcados, marcarTodos, vacio, children }) {
  const filas = Array.isArray(children) ? children : [children];
  return (
    <div className="tabla-scroll">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" title="Marcar todos" checked={ids.length > 0 && ids.every((i) => marcados.has(i))} onChange={() => marcarTodos(ids)} /></th>
            {cabecera.map((c) => <th key={c} className={/Bsale$|sistema$|Precio/.test(c) && c !== 'Nombre en Bsale' && c !== 'Nombre en el sistema' ? 'num' : ''}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas}
          {!filas.length && <tr><td colSpan={cabecera.length + 1}>{vacio}</td></tr>}
        </tbody>
      </table>
      {filas.length >= 1500 && <small>Se muestran las primeras 1500 filas; usa la búsqueda para encontrar el resto.</small>}
    </div>
  );
}
