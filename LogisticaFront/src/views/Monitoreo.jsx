'use client';

import { AdvancedMarker } from '@vis.gl/react-google-maps';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi } from '../api/services';
import ChatRuta from '../components/ChatRuta';
import { useAuth } from '../context/AuthContext';
import EstadoBadge from '../components/EstadoBadge';
import { AjustarVista, LineaPuntos, Mapa, MarcadorNumero, Polilinea, Seguir } from '../components/maps';
import { duracion, ESTADOS_PARADA, ESTADOS_RUTA, fechaHora, hace, hora, hoyISO, km, soles, VEHICULOS } from '../utils/format';

const COLORES = ['#2b6cb0', '#d53f8c', '#2f855a', '#dd6b20', '#6b46c1', '#00838f', '#b7791f', '#c53030'];
const REFRESCO_SEG = 10;

const colorParada = (p, colorRuta) =>
  p.estado === 'pendiente' ? colorRuta : ESTADOS_PARADA[p.estado].color;

/** Ruta en curso con camino restante calculado (conductor → pendientes → almacén). */
const enSeguimiento = (r) => r.estado === 'en_curso' && r.restante_polyline;

const contar = (r, estado) => r.paradas.filter((p) => p.estado === estado).length;

/** Próximo destino del conductor: "#3 Cliente" o "Almacén". */
function textoDestino(r) {
  const d = r.restante_destino;
  if (!d) return null;
  if (d.tipo === 'almacen') return 'Regreso al almacén';
  const p = r.paradas.find((x) => x.id === d.parada_id);
  return `#${p?.orden ?? '?'} ${d.titulo}`;
}

/** Hora estimada de llegada: momento del cálculo + duración. */
const llegada = (desde, segundos) => (desde && segundos != null ? hora(new Date(new Date(desde).getTime() + segundos * 1000).toISOString()) : '—');

/** Contadores y punto actual de una ruta. */
function Avance({ r }) {
  const d = r.estado === 'en_curso' ? r.restante_destino : null;
  return (
    <>
      <div className="contadores">
        <div><strong>{contar(r, 'pendiente')}</strong><small>Pendientes</small></div>
        <div className="ok"><strong>{contar(r, 'completada')}</strong><small>Entregadas</small></div>
        <div className="inc"><strong>{contar(r, 'incidencia')}</strong><small>Incidencias</small></div>
        <div className="can"><strong>{contar(r, 'cancelada')}</strong><small>Canceladas</small></div>
      </div>
      {d && (
        <p className="ahora">
          ▶ <strong>{textoDestino(r)}</strong> · {km(d.distancia_metros)} · {duracion(d.duracion_segundos)} · llega ~{llegada(r.restante_en, d.duracion_segundos)}
          <br />
          <small>
            Le falta en total {km(r.restante_distancia)} · {duracion(r.restante_duracion)} · vuelve al almacén ~{llegada(r.restante_en, r.restante_duracion)}
            {' '}(calculado {hace(r.restante_en)})
          </small>
        </p>
      )}
      {r.estado === 'en_curso' && !d && <p><small>El camino restante aparece cuando el conductor comparte su ubicación.</small></p>}
      {r.estado === 'finalizada' && <p>✔ Ruta terminada{r.finalizada_en ? ` a las ${hora(r.finalizada_en)}` : ''}</p>}
    </>
  );
}

/** Conductor o auxiliar que comparte su ubicación sin ruta en curso (o que no es el que se ve en su ruta). */
function PersonaLibre({ c }) {
  const reciente = Date.now() - new Date(c.registrado_en) < 10 * 60 * 1000;
  const estado = c.ruta_numero ? `Ruta ${c.ruta_numero} (${c.ruta_estado === 'planificada' ? 'sin iniciar' : c.ruta_estado.replace('_', ' ')})` : 'sin ruta';
  return (
    <AdvancedMarker position={{ lat: Number(c.lat), lng: Number(c.lng) }} title={`${c.nombre} · ${estado} · ${hace(c.registrado_en)}`} zIndex={900}>
      <div className={`vehiculo libre ${reciente ? '' : 'sin-senal'}`}>
        <span>{c.rol === 'auxiliar' ? '🧍' : '👤'}</span> {c.nombre}
        <small>{estado} · {hace(c.registrado_en)}</small>
      </div>
    </AdvancedMarker>
  );
}

/** Marcador del vehículo con el nombre del repartidor. */
function Vehiculo({ posicion, nombre, color, tipo }) {
  const reciente = Date.now() - new Date(posicion.registrado_en) < 10 * 60 * 1000;
  return (
    <AdvancedMarker position={{ lat: posicion.lat, lng: posicion.lng }} title={`${nombre} · ${hace(posicion.registrado_en)}`} zIndex={1000}>
      <div className={`vehiculo ${reciente ? '' : 'sin-senal'}`} style={{ borderColor: color }}>
        <span>{VEHICULOS[tipo]?.icono ?? '🚚'}</span> {nombre}
        <small>{hace(posicion.registrado_en)}</small>
      </div>
    </AdvancedMarker>
  );
}

export default function Monitoreo() {
  const params = useSearchParams();
  const [fecha, setFecha] = useState(params.get('fecha') || hoyISO());
  const [seleccion, setSeleccion] = useState(params.get('ruta') ? Number(params.get('ruta')) : 'todas');
  const [datos, setDatos] = useState(null);
  const [recorrido, setRecorrido] = useState([]);
  const [verRecorrido, setVerRecorrido] = useState(false);
  const [seguir, setSeguir] = useState(false);
  const [verSinRuta, setVerSinRuta] = useState(true);
  const [enVivo, setEnVivo] = useState(true);
  const [error, setError] = useState('');
  const [reordenando, setReordenando] = useState(false);
  const { usuario } = useAuth();
  const gestiona = ['admin', 'planificador'].includes(usuario.rol); // reoptimizar, abrir ruta
  const despacha = gestiona || usuario.rol === 'almacen'; // hoja de ruta y chat con el conductor
  const puedeVerPedido = (p) => usuario.rol !== 'vendedor' || p.vendedor_id === usuario.id;
  const [, setTick] = useState(0); // refresca los "hace N min"

  const cargar = useCallback(() => {
    rutasApi.monitoreo(fecha)
      .then((d) => { setDatos(d); setError(''); })
      .catch((e) => setError(mensajeError(e)));
  }, [fecha]);

  useEffect(() => {
    cargar();
    if (!enVivo) return;
    const t = setInterval(() => { cargar(); setTick((x) => x + 1); }, REFRESCO_SEG * 1000);
    return () => clearInterval(t);
  }, [cargar, enVivo]);

  const rutas = datos?.rutas ?? [];
  const color = (rutaId) => COLORES[rutas.findIndex((r) => r.id === rutaId) % COLORES.length];
  const ruta = seleccion === 'todas' ? null : rutas.find((r) => r.id === seleccion);
  const visibles = ruta ? [ruta] : rutas;

  useEffect(() => {
    if (!ruta || !verRecorrido) { setRecorrido([]); return; }
    rutasApi.recorrido(ruta.id).then(setRecorrido).catch(() => setRecorrido([]));
  }, [ruta?.id, verRecorrido, datos?.generado]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!datos) return error ? <p className="error">{error}</p> : <p>Cargando monitoreo…</p>;

  const puntos = [
    datos.deposito,
    ...visibles.flatMap((r) => [...r.paradas, ...(r.posicion ? [r.posicion] : [])]),
    ...(verSinRuta && !ruta ? datos.sinRuta : []),
  ].filter((p) => p.lat != null).map((p) => ({ lat: p.lat, lng: p.lng }));

  async function reoptimizarRuta() {
    if (!window.confirm(`¿Reordenar las paradas pendientes de la Ruta ${ruta.numero} por el camino más corto desde donde está el conductor? Se le avisará en la app.`)) return;
    setReordenando(true);
    try {
      await rutasApi.reoptimizar(ruta.id);
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setReordenando(false);
    }
  }

  // personas cuya posición no se está mostrando como vehículo de una ruta en curso
  const libres = (datos.conductores ?? []).filter((c) => {
    const r = rutas.find((x) => x.id === c.ruta_id);
    return !(r && r.estado === 'en_curso' && r.posicion?.usuario_id === c.usuario_id);
  });

  const progreso = (r) => `${r.paradas.filter((p) => p.estado !== 'pendiente').length}/${r.paradas.length}`;

  return (
    <>
      <div className="encabezado">
        <h2>Monitoreo de rutas</h2>
        <div className="fila">
          <input type="date" value={fecha} onChange={(e) => { setFecha(e.target.value); setSeleccion('todas'); }} />
          <label className="check"><input type="checkbox" checked={enVivo} onChange={(e) => setEnVivo(e.target.checked)} /> En vivo ({REFRESCO_SEG}s)</label>
          <small>Actualizado {fechaHora(datos.generado)}</small>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {/* Pestañas: todas las rutas o una en particular */}
      <div className="pestanas">
        <button className={seleccion === 'todas' ? 'activa' : ''} onClick={() => setSeleccion('todas')}>
          Todas ({rutas.length})
        </button>
        {rutas.map((r) => (
          <button key={r.id} className={seleccion === r.id ? 'activa' : ''} onClick={() => setSeleccion(r.id)}
            style={{ borderBottomColor: color(r.id) }}>
            <span className="punto" style={{ background: color(r.id) }} />
            Ruta {r.numero} · {r.repartidor_nombre ?? 'sin conductor'} <small>{progreso(r)}</small>
          </button>
        ))}
      </div>

      <div className="grid-ruta">
        <section className="tarjeta">
          <Mapa alto={620}>
            {/* encuadra al abrir o cambiar de ruta/fecha; el GPS que llega cada 15 s no mueve la vista */}
            {!seguir && <AjustarVista puntos={puntos} clave={`${fecha}-${seleccion}-${puntos.length > 1}`} />}
            {seguir && ruta?.posicion && <Seguir punto={{ lat: ruta.posicion.lat, lng: ruta.posicion.lng }} />}
            <MarcadorNumero position={datos.deposito} texto="A" color="#1a202c" title={datos.deposito.nombre} />
            {visibles.map((r) => (
              <Fragment key={r.id}>
                {/* planificado (tenue si ya hay seguimiento), lo que le falta y, más grueso, el tramo actual */}
                {r.polyline && <Polilinea codificada={r.polyline} color={color(r.id)} opacidad={enSeguimiento(r) ? 0.25 : 0.85} grosor={enSeguimiento(r) ? 4 : 5} />}
                {enSeguimiento(r) && <Polilinea codificada={r.restante_polyline} color={color(r.id)} opacidad={0.7} grosor={5} z={5} />}
                {enSeguimiento(r) && r.restante_tramo && <Polilinea codificada={r.restante_tramo} color={color(r.id)} opacidad={1} grosor={8} z={10} />}
                {r.paradas.map((p) => p.lat != null && (
                  <MarcadorNumero key={p.id} position={{ lat: p.lat, lng: p.lng }} texto={p.orden}
                    color={colorParada(p, color(r.id))} title={`${p.orden}. ${p.titulo} (${ESTADOS_PARADA[p.estado].label})`}
                    onClick={() => setSeleccion(r.id)} />
                ))}
                {r.posicion && <Vehiculo posicion={r.posicion} nombre={`R${r.numero} · ${r.repartidor_nombre ?? ''}`} color={color(r.id)} tipo={r.vehiculo_tipo} />}
              </Fragment>
            ))}
            {verRecorrido && <LineaPuntos puntos={recorrido} />}
            {!ruta && libres.map((c) => <PersonaLibre key={`c${c.usuario_id}`} c={c} />)}
            {verSinRuta && !ruta && datos.sinRuta.filter((p) => p.lat != null).map((p) => (
              <MarcadorNumero key={`s${p.id}`} position={{ lat: p.lat, lng: p.lng }} texto="•" color="#a0aec0"
                title={`Sin rutear: ${p.cliente_nombre}`} />
            ))}
          </Mapa>
          <div className="fila leyenda">
            <span><span className="punto" style={{ background: '#2f855a' }} /> Entregado</span>
            <span><span className="punto" style={{ background: '#c05621' }} /> Incidencia</span>
            <span><span className="punto" style={{ background: '#c53030' }} /> Cancelada</span>
            <span>━ Tramo actual · ─ Lo que falta</span>
            <span><span className="punto" style={{ background: '#a0aec0' }} /> Sin rutear</span>
            <span>🚚 Posición del conductor</span>
            {!ruta && <label className="check"><input type="checkbox" checked={verSinRuta} onChange={(e) => setVerSinRuta(e.target.checked)} /> Mostrar sin rutear</label>}
            {ruta && <label className="check"><input type="checkbox" checked={verRecorrido} onChange={(e) => setVerRecorrido(e.target.checked)} /> Recorrido GPS real</label>}
            {ruta?.posicion && <label className="check"><input type="checkbox" checked={seguir} onChange={(e) => setSeguir(e.target.checked)} /> Seguir al conductor</label>}
          </div>
        </section>

        <section className="tarjeta lista-paradas">
          {ruta ? (
            <>
              <div className="fila espacio">
                <h3>Ruta {ruta.numero} · {VEHICULOS[ruta.vehiculo_tipo]?.icono} {ruta.vehiculo_nombre ?? ''}<small>{ruta.repartidor_nombre ?? 'Sin conductor'}{ruta.asistente_nombre ? ` + ${ruta.asistente_nombre}` : ''}</small></h3>
                <EstadoBadge estado={ruta.estado} mapa={ESTADOS_RUTA} />
              </div>
              <p>
                {ruta.posicion
                  ? <>Última señal GPS: <strong>{hace(ruta.posicion.registrado_en)}</strong>{ruta.posicion.velocidad != null && ` · ${Math.round(ruta.posicion.velocidad * 3.6)} km/h`}</>
                  : <span className="error">Sin señal GPS hoy</span>}
              </p>
              <Avance r={ruta} />
              <p><small>Planificado: {ruta.paradas.length} paradas · {km(ruta.distancia_metros)} · {duracion(ruta.duracion_segundos)}</small></p>
              {gestiona && ruta.estado !== 'finalizada' && contar(ruta, 'pendiente') > 1 && (
                <button className="btn-sec" onClick={reoptimizarRuta} disabled={reordenando}>
                  {reordenando ? 'Reordenando…' : '🔀 Reoptimizar pendientes desde el conductor'}
                </button>
              )}
              <ol>
                {ruta.paradas.map((p) => (
                  <li key={p.id} className={ruta.estado === 'en_curso' && ruta.restante_destino?.parada_id === p.id ? 'actual' : ''}>
                    <div className="fila espacio">
                      {p.pedido_id ? (puedeVerPedido(p) ? <Link href={`/pedidos/${p.pedido_id}`}><strong>{p.titulo}</strong></Link> : <strong>{p.titulo}</strong>) : <strong>⚑ {p.titulo}</strong>}
                      <EstadoBadge estado={p.estado} mapa={ESTADOS_PARADA} />
                    </div>
                    <small>{[p.direccion, p.distrito].filter(Boolean).join(', ')}</small>
                    {p.pedido_id && <small>#{p.pedido_id} · {p.cobrar}{p.cobrar !== 'No Cobrar' && ` ${soles(p.total_pedido)}`}{p.cliente_telefono && ` · ${p.cliente_telefono}`}</small>}
                    {p.completada_en && <small>{ESTADOS_PARADA[p.estado].label} a las <strong>{hora(p.completada_en)}</strong>{p.nota && ` — ${p.nota}`}</small>}
                    {p.foto_url && <small><a href={p.foto_url} target="_blank" rel="noreferrer">📷 Ver foto de la entrega</a></small>}
                  </li>
                ))}
              </ol>
              <div className="fila">
                {gestiona && <Link href={`/rutas/${ruta.id}`}>Abrir ruta</Link>}
                {despacha && <Link href={`/despacho/${ruta.id}`}>Hoja de ruta</Link>}
              </div>
              {despacha && (
                <>
                  <h3 style={{ marginTop: 16 }}>💬 Chat</h3>
                  <ChatRuta rutaId={ruta.id} alto={240} />
                </>
              )}
            </>
          ) : (
            <>
              <h3>Resumen del día</h3>
              <table>
                <thead><tr><th>Ruta</th><th title="Pendientes">Pend.</th><th title="Entregadas">Entr.</th><th title="Incidencias">Inc.</th><th title="Canceladas">Canc.</th><th>Ahora</th><th>GPS</th><th>Estado</th></tr></thead>
                <tbody>
                  {rutas.map((r) => (
                    <tr key={r.id} className="clic" onClick={() => setSeleccion(r.id)}>
                      <td><span className="punto" style={{ background: color(r.id) }} /> Ruta {r.numero} · {r.repartidor_nombre ?? '—'}</td>
                      <td>{contar(r, 'pendiente')}</td>
                      <td>{contar(r, 'completada')}</td>
                      <td>{contar(r, 'incidencia')}</td>
                      <td>{contar(r, 'cancelada')}</td>
                      <td>{r.estado === 'en_curso' ? (textoDestino(r) ?? '—') : r.estado === 'finalizada' ? `Terminó ${r.finalizada_en ? hora(r.finalizada_en) : ''}` : '—'}</td>
                      <td>{r.posicion ? hace(r.posicion.registrado_en) : '—'}</td>
                      <td><EstadoBadge estado={r.estado} mapa={ESTADOS_RUTA} /></td>
                    </tr>
                  ))}
                  {!rutas.length && <tr><td colSpan={8}>No hay rutas para esta fecha.{gestiona && <> <Link href="/rutas">Planificar</Link></>}</td></tr>}
                </tbody>
              </table>
              <p>Pedidos sin rutear: <strong>{datos.sinRuta.length}</strong></p>
              {(datos.conductores ?? []).length > 0 && (
                <>
                  <h3 style={{ marginTop: 16 }}>Ubicación del equipo</h3>
                  <table>
                    <thead><tr><th>Persona</th><th>Ruta</th><th>Última señal</th></tr></thead>
                    <tbody>
                      {datos.conductores.map((c) => (
                        <tr key={c.usuario_id}>
                          <td>{c.rol === 'auxiliar' ? '🧍' : '👤'} {c.nombre}</td>
                          <td>{c.ruta_numero ? `Ruta ${c.ruta_numero} · ${c.ruta_estado === 'planificada' ? 'sin iniciar' : c.ruta_estado.replace('_', ' ')}` : 'Sin ruta'}</td>
                          <td>{hace(c.registrado_en)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
