'use client';

import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi, usuariosApi, vehiculosApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { AjustarVista, hayMapsKey, Mapa, MarcadorNumero, Polilinea, SinMapsKey } from '../components/maps';
import { ESTADOS_PARADA, ESTADOS_RUTA, fechaCorta, hora, hoyISO, km, VEHICULOS } from '../utils/format';

const COLORES = ['#2b6cb0', '#d53f8c', '#2f855a', '#dd6b20', '#6b46c1', '#00838f', '#b7791f', '#c53030'];
const REFRESCO_SEG = 20;
const franjaTexto = (p) => (p.franja_desde || p.franja_hasta
  ? `${String(p.franja_desde ?? '').slice(0, 5) || '…'}–${String(p.franja_hasta ?? '').slice(0, 5) || '…'}` : null);

/** Punto dentro de un polígono (lat/lng como plano: suficiente dentro de una ciudad). */
function dentro(p, vertices) {
  let adentro = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) adentro = !adentro;
  }
  return adentro;
}

/** Polígono que se va dibujando con clics sobre el mapa. */
function Area({ vertices }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !vertices.length) return undefined;
    const forma = vertices.length > 2
      ? new window.google.maps.Polygon({ paths: vertices, map, strokeColor: '#dd6b20', strokeWeight: 2, fillColor: '#dd6b20', fillOpacity: 0.12, clickable: false })
      : new window.google.maps.Polyline({ path: vertices, map, strokeColor: '#dd6b20', strokeWeight: 2, clickable: false });
    return () => forma.setMap(null);
  }, [map, vertices]);
  return null;
}

/**
 * Tablero de despacho (como el de Shipday): en un solo lugar el mapa con los pedidos sin asignar, las rutas
 * del día con la hora estimada de llegada a cada parada y los conductores en vivo. Se seleccionan pedidos
 * (clic o dibujando un área) y se asignan a una ruta, o se reparten automáticamente.
 */
export default function Tablero() {
  const [fecha, setFecha] = useState(hoyISO());
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [seleccion, setSeleccion] = useState(new Set());
  const [destino, setDestino] = useState('');
  const [dibujando, setDibujando] = useState(false);
  const [vertices, setVertices] = useState([]);
  const [abiertas, setAbiertas] = useState(new Set());
  const [propuesta, setPropuesta] = useState(null);
  const [nuevaRuta, setNuevaRuta] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await rutasApi.monitoreo(fecha));
      setError('');
    } catch (err) {
      setError(mensajeError(err));
    }
  }, [fecha]);

  useEffect(() => { setDatos(null); setSeleccion(new Set()); cargar(); }, [cargar]);
  useEffect(() => {
    if (ocupado || propuesta || nuevaRuta) return undefined;
    const t = setInterval(cargar, REFRESCO_SEG * 1000);
    return () => clearInterval(t);
  }, [cargar, ocupado, propuesta, nuevaRuta]);

  async function tarea(texto, fn) {
    setOcupado(texto);
    setError('');
    setAviso('');
    try {
      const m = await fn();
      if (m) setAviso(m);
      await cargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado('');
    }
  }

  const rutas = useMemo(() => (datos?.rutas ?? []).map((r, i) => ({ ...r, color: COLORES[i % COLORES.length] })), [datos]);
  const sinRuta = datos?.sinRuta ?? [];
  const conUbicacion = sinRuta.filter((p) => p.lat != null);
  const planificadas = rutas.filter((r) => r.estado !== 'finalizada');

  const alternar = (id) => setSeleccion((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function terminarArea() {
    if (vertices.length >= 3) {
      const ids = conUbicacion.filter((p) => dentro({ lat: Number(p.lat), lng: Number(p.lng) }, vertices)).map((p) => p.id);
      setSeleccion((s) => new Set([...s, ...ids]));
      setAviso(`${ids.length} pedido(s) dentro del área seleccionados`);
    }
    setDibujando(false);
    setVertices([]);
  }

  const asignar = () => tarea('Asignando y trazando la ruta…', async () => {
    const ids = [...seleccion];
    const r = await rutasApi.agregarPedidos(Number(destino), ids);
    setSeleccion(new Set());
    setAbiertas((a) => new Set([...a, Number(destino)]));
    return `${ids.length} pedido(s) asignados a la Ruta ${r.numero}${r.aviso ? ` · ${r.aviso}` : ' y ruta optimizada ✔'}`;
  });

  const proponer = () => tarea('Calculando el mejor reparto…', async () => {
    const body = { fecha, ...(seleccion.size ? { pedido_ids: [...seleccion] } : {}) };
    setPropuesta({ ...(await rutasApi.asignarAuto(body)), body });
    return null;
  });

  const aplicar = () => tarea('Asignando pedidos y trazando las rutas…', async () => {
    const r = await rutasApi.asignarAuto({ ...propuesta.body, aplicar: true });
    setPropuesta(null);
    setSeleccion(new Set());
    const agregados = r.resultados.reduce((s, x) => s + x.agregados, 0);
    const avisos = r.resultados.filter((x) => x.aviso || x.error).map((x) => `Ruta ${x.numero}: ${x.error ?? x.aviso}`);
    return `${agregados} pedido(s) asignados en ${r.resultados.length} ruta(s) ✔${avisos.length ? ` · ${avisos.join(' · ')}` : ''}`;
  });

  const optimizar = (r) => tarea(`Optimizando la Ruta ${r.numero}…`, async () => {
    await rutasApi.trazar(r.id, true);
    return `Ruta ${r.numero} optimizada ✔`;
  });

  const cambiarSalida = (r, valor) => {
    if (!valor || valor === String(r.hora_salida ?? '').slice(0, 5)) return;
    tarea('Recalculando horas de llegada…', async () => {
      await rutasApi.actualizar(r.id, { hora_salida: valor });
      return `Ruta ${r.numero}: sale a las ${valor}; horas de llegada recalculadas ✔`;
    });
  };

  const puntosVista = useMemo(() => [
    ...(datos?.deposito ? [datos.deposito] : []),
    ...conUbicacion.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
    ...rutas.flatMap((r) => r.paradas.filter((p) => p.lat != null).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))),
  ], [datos]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tablero">
      <aside className="tablero-panel">
        <div className="fila espacio">
          <h2>Tablero de despacho</h2>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="fila">
          <button onClick={proponer} disabled={!!ocupado || !sinRuta.length}>⚡ Asignar automáticamente{seleccion.size ? ` (${seleccion.size})` : ''}</button>
          <button className="btn-sec" onClick={() => setNuevaRuta({ repartidor_id: '', vehiculo_id: '', hora_salida: '09:00' })} disabled={!!ocupado}>+ Nueva ruta</button>
        </div>
        {ocupado && <p className="aviso">⏳ {ocupado}</p>}
        {aviso && <p className="aviso">{aviso}</p>}
        {error && <p className="error">{error}</p>}

        {seleccion.size > 0 && (
          <div className="tarjeta seleccion-barra">
            <strong>{seleccion.size} pedido(s) seleccionados</strong>
            <div className="fila">
              <select value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">Asignar a…</option>
                {planificadas.map((r) => <option key={r.id} value={r.id}>Ruta {r.numero} · {r.repartidor_nombre ?? 'sin conductor'} ({r.total_paradas})</option>)}
              </select>
              <button onClick={asignar} disabled={!destino || !!ocupado}>Asignar</button>
              <button className="btn-link-oscuro" onClick={() => setSeleccion(new Set())}>Quitar selección</button>
            </div>
          </div>
        )}

        <section>
          <div className="fila espacio">
            <h3>Sin asignar ({sinRuta.length})</h3>
            {conUbicacion.length > 0 && <button className="btn-link-oscuro" onClick={() => setSeleccion(new Set(conUbicacion.map((p) => p.id)))}>Seleccionar todos</button>}
          </div>
          {!datos && <p>Cargando…</p>}
          {datos && !sinRuta.length && <p><small>Todos los pedidos del día están en una ruta ✔</small></p>}
          <ul className="tablero-lista">
            {sinRuta.map((p) => (
              <li key={p.id} className={seleccion.has(p.id) ? 'marcado' : ''}>
                <label className="check">
                  <input type="checkbox" disabled={p.lat == null} checked={seleccion.has(p.id)} onChange={() => alternar(p.id)} />
                  <span>
                    <strong>{p.cliente_nombre}</strong> <Link href={`/pedidos/${p.id}`}><small>#{p.id}</small></Link>
                    <small>{[p.distrito, p.direccion].filter(Boolean).join(' · ')}</small>
                    {franjaTexto(p) && <span className="chip-franja">🕘 {franjaTexto(p)}</span>}
                    {p.lat == null && <small className="error">Sin ubicación: no se puede rutear</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Rutas del {fechaCorta(fecha)} ({rutas.length})</h3>
          {datos && !rutas.length && <p><small>No hay rutas este día. Crea una con “+ Nueva ruta”.</small></p>}
          {rutas.map((r) => {
            const abierta = abiertas.has(r.id);
            const fuera = r.paradas.filter((p) => p.eta_fuera_franja && p.estado === 'pendiente').length;
            return (
              <div key={r.id} className="tarjeta tablero-ruta" style={{ borderLeftColor: r.color }}>
                <div className="fila espacio">
                  <strong>Ruta {r.numero}</strong>
                  <EstadoBadge estado={r.estado} mapa={ESTADOS_RUTA} />
                </div>
                <small>{VEHICULOS[r.vehiculo_tipo]?.icono ?? '🚚'} {r.vehiculo_nombre ?? 'sin vehículo'} · {r.repartidor_nombre ?? 'sin conductor'}{r.asistente_nombre ? ` + ${r.asistente_nombre}` : ''}</small>
                <div className="fila tablero-ruta-datos">
                  <label>Sale
                    <input type="time" defaultValue={String(r.hora_salida ?? '09:00').slice(0, 5)} disabled={r.estado !== 'planificada' || !!ocupado}
                      onBlur={(e) => cambiarSalida(r, e.target.value)} />
                  </label>
                  <span><strong>{r.total_paradas}</strong> paradas</span>
                  <span>{km(r.distancia_metros)}</span>
                  <span>Vuelve ~<strong>{hora(r.regreso_estimado)}</strong></span>
                </div>
                {fuera > 0 && <small className="error">⚠ {fuera} parada(s) llegarían fuera de su franja</small>}
                <div className="fila">
                  <button className="btn-link-oscuro" onClick={() => setAbiertas((a) => { const n = new Set(a); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                    {abierta ? '▾ Ocultar paradas' : '▸ Ver paradas'}
                  </button>
                  {r.estado !== 'finalizada' && r.paradas.length > 1 && <button className="btn-link-oscuro" onClick={() => optimizar(r)} disabled={!!ocupado}>Optimizar</button>}
                  <Link href={`/rutas/${r.id}`}>Editar</Link>
                </div>
                {abierta && (
                  <ol className="tablero-paradas">
                    {r.paradas.map((p) => (
                      <li key={p.id} className={p.estado !== 'pendiente' ? 'atendida' : ''}>
                        <span className="eta" title="Hora estimada de llegada">{p.estado === 'pendiente' ? hora(p.eta) : ESTADOS_PARADA[p.estado]?.label ?? p.estado}</span>
                        <span>
                          {p.titulo}
                          <small>{[p.distrito, franjaTexto(p) && `🕘 ${franjaTexto(p)}`].filter(Boolean).join(' · ')}</small>
                          {p.eta_fuera_franja && p.estado === 'pendiente' && <small className="error">llegaría fuera de su franja</small>}
                        </span>
                      </li>
                    ))}
                    {!r.paradas.length && <li><small>Sin paradas</small></li>}
                  </ol>
                )}
              </div>
            );
          })}
        </section>
      </aside>

      <div className="tablero-mapa">
        {hayMapsKey ? (
          <>
            <div className="tablero-herramientas">
              {!dibujando
                ? <button className="btn-sec" onClick={() => { setDibujando(true); setVertices([]); }} title="Dibuja un área sobre el mapa para seleccionar los pedidos de esa zona">⬠ Seleccionar área</button>
                : <>
                  <span className="aviso">Haz clic en el mapa para marcar los vértices ({vertices.length})</span>
                  <button onClick={terminarArea} disabled={vertices.length < 3}>Seleccionar pedidos del área</button>
                  <button className="btn-sec" onClick={() => { setDibujando(false); setVertices([]); }}>Cancelar</button>
                </>}
            </div>
            <Mapa alto="100%" className={dibujando ? 'dibujando' : ''}
              onClick={(e) => { if (dibujando && e.detail.latLng) setVertices((v) => [...v, e.detail.latLng]); }}>
              <AjustarVista puntos={puntosVista} clave={`${fecha}-${datos ? 'ok' : ''}`} />
              {datos?.deposito && <MarcadorNumero position={datos.deposito} texto="🏠" color="#1a202c" title={datos.deposito.nombre} />}
              {rutas.map((r) => (
                <Polilinea key={`l${r.id}`} codificada={r.estado === 'en_curso' && r.restante_polyline ? r.restante_polyline : r.polyline} color={r.color} />
              ))}
              {rutas.flatMap((r) => r.paradas.filter((p) => p.lat != null).map((p) => (
                <MarcadorNumero key={`p${p.id}`} position={{ lat: Number(p.lat), lng: Number(p.lng) }} texto={p.orden}
                  color={p.estado === 'pendiente' ? r.color : ESTADOS_PARADA[p.estado]?.color ?? '#a0aec0'}
                  title={`Ruta ${r.numero} · #${p.orden} ${p.titulo}${p.eta ? ` · llega ~${hora(p.eta)}` : ''}${franjaTexto(p) ? ` · franja ${franjaTexto(p)}` : ''}`} />
              )))}
              {conUbicacion.map((p) => (
                <AdvancedMarker key={`s${p.id}`} position={{ lat: Number(p.lat), lng: Number(p.lng) }} zIndex={seleccion.has(p.id) ? 800 : 700}
                  title={`${p.cliente_nombre}${franjaTexto(p) ? ` · franja ${franjaTexto(p)}` : ''} · clic para seleccionar`}
                  onClick={() => !dibujando && alternar(p.id)}>
                  <div className={`marcador marcador-libre ${seleccion.has(p.id) ? 'elegido' : ''}`}>{franjaTexto(p) ? '🕘' : '•'}</div>
                </AdvancedMarker>
              ))}
              {(datos?.conductores ?? []).map((c) => (
                <AdvancedMarker key={`c${c.usuario_id}`} position={{ lat: Number(c.lat), lng: Number(c.lng) }} zIndex={900} title={c.nombre}>
                  <div className="vehiculo"><span>{c.rol === 'auxiliar' ? '🧍' : '🚚'}</span> {c.nombre}</div>
                </AdvancedMarker>
              ))}
              <Area vertices={vertices} />
            </Mapa>
          </>
        ) : <SinMapsKey />}
      </div>

      {propuesta && (
        <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && setPropuesta(null)}>
          <div className="modal modal-mapa tarjeta">
            <h3>Asignación automática — propuesta</h3>
            <p><small>Cada pedido va a la ruta donde menos alarga el recorrido, respetando franjas horarias, el máximo de 25 paradas y repartiendo la carga. Las horas son aproximadas; al aplicar, Google traza cada ruta y calcula las horas exactas.</small></p>
            {propuesta.descartadas?.map((d) => <p key={d.ruta_id} className="aviso">Ruta {d.numero} no se usa: {d.motivo}</p>)}
            <div className="propuesta-rutas">
              {propuesta.propuesta.map((r) => (
                <div key={r.ruta_id} className="tarjeta">
                  <strong>Ruta {r.numero}</strong> <small>{r.conductor ?? 'sin conductor'} · {r.vehiculo ?? 'sin vehículo'} · +{r.nuevos} pedido(s) · vuelve ~{hora(r.regreso_estimado)}</small>
                  <ol className="tablero-paradas">
                    {r.paradas.map((p, i) => (
                      <li key={i} className={p.nuevo ? 'nuevo' : ''}>
                        <span className="eta">{hora(p.eta)}</span>
                        <span>{p.cliente}{p.nuevo && <strong className="chip-nuevo">nuevo</strong>}
                          <small>{[p.distrito, p.franja && `🕘 ${p.franja}`].filter(Boolean).join(' · ')}</small>
                          {p.fuera_de_franja && <small className="error">llegaría fuera de su franja</small>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
            {propuesta.sinAsignar.length > 0 && (
              <p className="error">Sin asignar: {propuesta.sinAsignar.map((s) => `${s.cliente} (${s.motivo})`).join(' · ')}</p>
            )}
            <div className="fila">
              <button onClick={aplicar} disabled={!!ocupado || !propuesta.propuesta.some((r) => r.nuevos)}>Aplicar asignación</button>
              <button className="btn-sec" onClick={() => setPropuesta(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {nuevaRuta && <NuevaRuta fecha={fecha} valores={nuevaRuta} onCerrar={() => setNuevaRuta(null)}
        onCreada={(r) => { setNuevaRuta(null); setAviso(`Ruta ${r.numero} creada ✔`); cargar(); }} />}
    </div>
  );
}

/** Crear rápido una ruta del día: conductor, vehículo y hora de salida. */
function NuevaRuta({ fecha, valores, onCerrar, onCreada }) {
  const [form, setForm] = useState(valores);
  const [conductores, setConductores] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    usuariosApi.listar({ rol: 'repartidor', activos: true }).then(setConductores).catch(() => {});
    vehiculosApi.listar({ activos: true }).then(setVehiculos).catch(() => {});
  }, []);
  async function crear(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await rutasApi.crear({
        fecha, repartidor_id: form.repartidor_id ? Number(form.repartidor_id) : null, vehiculo_id: form.vehiculo_id ? Number(form.vehiculo_id) : null,
      });
      if (form.hora_salida) await rutasApi.actualizar(r.id, { hora_salida: form.hora_salida });
      onCreada(r);
    } catch (err) {
      setError(mensajeError(err));
    }
  }
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <form className="modal tarjeta" onSubmit={crear}>
        <h3>Nueva ruta del {fechaCorta(fecha)}</h3>
        <label>Conductor
          <select value={form.repartidor_id} onChange={(e) => setForm({ ...form, repartidor_id: e.target.value })}>
            <option value="">— Asignar después —</option>
            {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Vehículo
          <select value={form.vehiculo_id} onChange={(e) => setForm({ ...form, vehiculo_id: e.target.value })}>
            <option value="">— Sin vehículo —</option>
            {vehiculos.map((v) => <option key={v.id} value={v.id}>{VEHICULOS[v.tipo]?.icono ?? ''} {v.nombre}{v.placa ? ` (${v.placa})` : ''}</option>)}
          </select>
        </label>
        <label>Hora de salida del almacén<input type="time" value={form.hora_salida} onChange={(e) => setForm({ ...form, hora_salida: e.target.value })} /></label>
        {error && <p className="error">{error}</p>}
        <div className="fila">
          <button>Crear ruta</button>
          <button type="button" className="btn-sec" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
