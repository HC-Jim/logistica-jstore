'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { preciosApi } from '../api/services';
import ProductoBuscador from '../components/ProductoBuscador';
import { useAuth } from '../context/AuthContext';
import { textoFuente } from '../utils/bsale';
import { fechaCorta, fechaHora, hoyISO, soles } from '../utils/format';
import { tiene } from '../utils/roles';

const pct = (precio, normal) => (normal > 0 ? `${(100 * (1 - precio / normal)).toFixed(1)} %` : '—');

/**
 * Consultar precio: precio vigente por plataforma, precios en las listas de Bsale, historial y registro de un precio nuevo.
 * Con `modoRegistro` (Registrar precios → Individual) el formulario se abre al elegir el SKU.
 */
export default function PreciosConsultar({ modoRegistro = false }) {
  const { usuario } = useAuth();
  const puedeEditar = tiene(usuario, 'admin', 'catalogo');
  const [plataformas, setPlataformas] = useState([]);
  const [producto, setProducto] = useState(null);
  const [vigente, setVigente] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [nuevo, setNuevo] = useState(null); // { fecha, precio_normal, precios: { plataforma_id: precio } }
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [bsale, setBsale] = useState(null);
  const [leyendoBsale, setLeyendoBsale] = useState(false);

  useEffect(() => { preciosApi.plataformas().then(setPlataformas).catch(() => {}); }, []);

  async function cargar(p) {
    setError('');
    setAviso('');
    setProducto(p);
    setNuevo(null);
    setBsale(null);
    try {
      const [[v], h] = await Promise.all([preciosApi.vigentes({ producto_id: p.id, todos: 1 }), preciosApi.historial(p.id)]);
      setVigente(v);
      setHistorial(h);
      if (modoRegistro && puedeEditar) empezarRegistro(v);
      preciosApi.bsaleDeProducto(p.id).then(setBsale).catch(() => setBsale(null));
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  /** Lee en Bsale, en este momento, los precios del producto en cada lista. */
  async function leerBsale() {
    setLeyendoBsale(true);
    try {
      setBsale(await preciosApi.bsaleDeProducto(producto.id, true));
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setLeyendoBsale(false);
    }
  }

  function empezarRegistro(v = vigente) {
    const precios = Object.fromEntries(plataformas.filter((pl) => pl.activo).map((pl) => [pl.id, v?.precios?.[pl.nombre]?.precio ?? '']));
    setNuevo({ fecha: hoyISO(), precio_normal: v?.precio_normal ?? '', precios });
  }

  async function guardar(e) {
    e.preventDefault();
    setError('');
    try {
      const precios = Object.entries(nuevo.precios)
        .filter(([id, v]) => v !== '' && Number(v) !== Number(vigente?.precios?.[plataformas.find((p) => p.id === Number(id))?.nombre]?.precio))
        .map(([id, v]) => ({ plataforma_id: Number(id), precio: Number(v) }));
      if (!precios.length) throw new Error('No cambiaste ningún precio');
      const r = await preciosApi.registrar({ producto_id: producto.id, fecha: nuevo.fecha, precio_normal: nuevo.precio_normal === '' ? null : Number(nuevo.precio_normal), precios });
      setAviso(`Se registraron ${precios.length} precio(s) ✔${textoBsale(r.bsale)}`);
      await cargar(producto);
    } catch (err) {
      setError(err.response ? mensajeError(err) : err.message);
    }
  }

  const activas = plataformas.filter((p) => p.activo);
  return (
    <>
      {!modoRegistro && <h2>Consultar precio</h2>}
      <section className="tarjeta">
        <ProductoBuscador onSeleccionar={cargar} />
        <small>Escribe el SKU o parte del nombre.</small>
      </section>
      {error && <p className="error">{error}</p>}
      {aviso && <p className="aviso">{aviso}</p>}

      {producto && vigente && (
        <>
          <section className="tarjeta">
            <div className="fila espacio">
              <h3>{vigente.sku} · {vigente.descripcion}</h3>
              {puedeEditar && !nuevo && <button onClick={() => empezarRegistro()}>Registrar precio nuevo</button>}
            </div>
            <p>
              <small>{[vigente.categoria, vigente.marca && `${vigente.marca}${vigente.marca_propia ? ' (propia)' : ''}`, vigente.estado_sourcing, !vigente.activo && 'INACTIVO'].filter(Boolean).join(' · ')}</small>
            </p>
            <p>Precio normal: <strong className="tachado">{vigente.precio_normal != null ? soles(vigente.precio_normal) : '—'}</strong></p>
            <div className="precios-plataformas">
              {activas.map((pl) => {
                const v = vigente.precios[pl.nombre];
                return (
                  <div key={pl.id} className={`precio-plataforma ${v ? '' : 'sin-precio'}`}>
                    <small>{pl.nombre}</small>
                    <strong>{v ? soles(v.precio) : '—'}</strong>
                    {v && <small>{pct(v.precio, v.precio_normal ?? vigente.precio_normal)} desc. · {fechaCorta(v.fecha)}</small>}
                  </div>
                );
              })}
            </div>
          </section>

          {bsale?.activo && (
            <section className="tarjeta">
              <div className="fila espacio">
                <h3>Listas de precio en Bsale</h3>
                {bsale.existe && <button className="btn-sec" onClick={leerBsale} disabled={leyendoBsale}>{leyendoBsale ? 'Consultando…' : '⟳ Consultar en Bsale ahora'}</button>}
              </div>
              {!bsale.existe ? (
                <p><small>Este SKU no está en Bsale (o aún no se leyó Bsale). {puedeEditar && <>Se puede crear desde <Link href="/precios/bsale">Precios → Bsale</Link>.</>}</small></p>
              ) : (
                <>
                  {bsale.conflicto && <p className="error">⚠ En Bsale este SKU es otro producto: “{bsale.nombre_bsale}”. No se le envían precios hasta corregirlo.</p>}
                  <table>
                    <thead><tr><th>Lista</th><th>Toma el precio de</th><th className="num">En Bsale</th><th>Estado</th></tr></thead>
                    <tbody>
                      {bsale.listas.map((l) => (
                        <tr key={l.id}>
                          <td><strong>{l.nombre}</strong></td>
                          <td><small>{textoFuente(l)}</small></td>
                          <td className="num" title={l.leido_en ? `Leído el ${fechaHora(l.leido_en)}` : ''}>{l.precio ? soles(l.precio) : '—'}</td>
                          <td>{l.pendiente != null
                            ? <span className="error">Pendiente: {soles(l.pendiente)}</span>
                            : l.fuente === 'ninguna' ? <small>—</small> : <small>✔ al día</small>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>
          )}

          {nuevo && (
            <form className="tarjeta form-grid" onSubmit={guardar}>
              <h3 className="ancho">Registrar precio nuevo</h3>
              <label>Fecha<input type="date" max={hoyISO()} value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} /></label>
              <label>Precio normal (S/)<input type="number" min="0" step="0.01" value={nuevo.precio_normal} onChange={(e) => setNuevo({ ...nuevo, precio_normal: e.target.value })} /></label>
              <p className="ancho"><small>Solo se guardan las plataformas cuyo precio cambies.</small></p>
              {activas.map((pl) => (
                <label key={pl.id}>{pl.nombre} (S/)
                  <input type="number" min="0" step="0.01" value={nuevo.precios[pl.id] ?? ''}
                    onChange={(e) => setNuevo({ ...nuevo, precios: { ...nuevo.precios, [pl.id]: e.target.value } })} />
                  {nuevo.precio_normal > 0 && nuevo.precios[pl.id] !== '' && <small>{pct(Number(nuevo.precios[pl.id]), Number(nuevo.precio_normal))} desc.</small>}
                </label>
              ))}
              <div className="fila ancho">
                <button>Guardar precios</button>
                <button type="button" className="btn-sec" onClick={() => setNuevo(null)}>Cancelar</button>
              </div>
            </form>
          )}

          <section className="tarjeta">
            <h3>Historial ({historial.length})</h3>
            <div className="tabla-scroll alto-limitado">
              <table>
                <thead><tr><th>Fecha</th><th>Plataforma</th><th className="num">Precio</th><th className="num">Normal</th><th className="num">Desc.</th><th>Registrado por</th></tr></thead>
                <tbody>
                  {historial.map((h) => (
                    <tr key={h.id}>
                      <td>{fechaCorta(h.fecha)}</td><td>{h.plataforma}</td>
                      <td className="num">{soles(h.precio)}</td>
                      <td className="num">{h.precio_normal != null ? soles(h.precio_normal) : '—'}</td>
                      <td className="num">{h.descuento != null ? `${h.descuento} %` : '—'}</td>
                      <td>{h.registrado_por ?? <small>importado</small>}</td>
                    </tr>
                  ))}
                  {!historial.length && <tr><td colSpan={6}>Sin precios registrados.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

/** Resultado del envío a Bsale después de registrar el precio. */
function textoBsale(b) {
  if (!b?.activo) return '';
  if (b.existe === false) return ' · Este SKU no existe en Bsale (créalo desde Precios → Bsale).';
  if (!b.ok) return ` · ⚠ Bsale no se actualizó: ${b.mensaje ?? 'revisa el Registro de envíos en Precios → Bsale'}`;
  return b.enviados ? ` · Bsale actualizado (${b.enviados} lista(s)) ✔` : ' · Bsale ya tenía estos precios ✔';
}
