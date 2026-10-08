'use client';

import { AdvancedMarker } from '@vis.gl/react-google-maps';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { AjustarVista, LineaPuntos, Mapa, MarcadorNumero, Polilinea } from '../components/maps';
import { duracion, ESTADOS_PARADA, ESTADOS_RUTA, fechaHora, hace, hoyISO, km, soles } from '../utils/format';

const COLORES = ['#2b6cb0', '#d53f8c', '#2f855a', '#dd6b20', '#6b46c1', '#00838f', '#b7791f', '#c53030'];
const REFRESCO_SEG = 15;

const colorParada = (p, colorRuta) =>
  p.estado === 'pendiente' ? colorRuta : ESTADOS_PARADA[p.estado].color;

/** Marcador del vehículo con el nombre del repartidor. */
function Vehiculo({ posicion, nombre, color }) {
  const reciente = Date.now() - new Date(posicion.registrado_en) < 10 * 60 * 1000;
  return (
    <AdvancedMarker position={{ lat: posicion.lat, lng: posicion.lng }} title={`${nombre} · ${hace(posicion.registrado_en)}`} zIndex={1000}>
      <div className={`vehiculo ${reciente ? '' : 'sin-senal'}`} style={{ borderColor: color }}>
        <span>🚚</span> {nombre}
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
  const [verSinRuta, setVerSinRuta] = useState(true);
  const [enVivo, setEnVivo] = useState(true);
  const [error, setError] = useState('');
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
            {r.repartidor_nombre}{r.nombre ? ` · ${r.nombre}` : ''} <small>{progreso(r)}</small>
          </button>
        ))}
      </div>

      <div className="grid-ruta">
        <section className="tarjeta">
          <Mapa alto={620}>
            <AjustarVista puntos={puntos} />
            <MarcadorNumero position={datos.deposito} texto="A" color="#1a202c" title={datos.deposito.nombre} />
            {visibles.map((r) => (
              <Fragment key={r.id}>
                {r.polyline && <Polilinea codificada={r.polyline} color={color(r.id)} />}
                {r.paradas.map((p) => p.lat != null && (
                  <MarcadorNumero key={p.id} position={{ lat: p.lat, lng: p.lng }} texto={p.orden}
                    color={colorParada(p, color(r.id))} title={`${p.orden}. ${p.titulo} (${ESTADOS_PARADA[p.estado].label})`}
                    onClick={() => setSeleccion(r.id)} />
                ))}
                {r.posicion && <Vehiculo posicion={r.posicion} nombre={r.repartidor_nombre} color={color(r.id)} />}
              </Fragment>
            ))}
            {verRecorrido && <LineaPuntos puntos={recorrido} />}
            {verSinRuta && !ruta && datos.sinRuta.filter((p) => p.lat != null).map((p) => (
              <MarcadorNumero key={`s${p.id}`} position={{ lat: p.lat, lng: p.lng }} texto="•" color="#a0aec0"
                title={`Sin rutear: ${p.cliente_nombre}`} />
            ))}
          </Mapa>
          <div className="fila leyenda">
            <span><span className="punto" style={{ background: '#2f855a' }} /> Entregado</span>
            <span><span className="punto" style={{ background: '#c05621' }} /> Incidencia</span>
            <span><span className="punto" style={{ background: '#a0aec0' }} /> Sin rutear</span>
            <span>🚚 Posición del conductor</span>
            {!ruta && <label className="check"><input type="checkbox" checked={verSinRuta} onChange={(e) => setVerSinRuta(e.target.checked)} /> Mostrar sin rutear</label>}
            {ruta && <label className="check"><input type="checkbox" checked={verRecorrido} onChange={(e) => setVerRecorrido(e.target.checked)} /> Recorrido GPS real</label>}
          </div>
        </section>

        <section className="tarjeta lista-paradas">
          {ruta ? (
            <>
              <div className="fila espacio">
                <h3>{ruta.repartidor_nombre}{ruta.asistente_nombre ? ` + ${ruta.asistente_nombre}` : ''}</h3>
                <EstadoBadge estado={ruta.estado} mapa={ESTADOS_RUTA} />
              </div>
              <p>
                {ruta.posicion
                  ? <>Última señal GPS: <strong>{hace(ruta.posicion.registrado_en)}</strong>{ruta.posicion.velocidad != null && ` · ${Math.round(ruta.posicion.velocidad * 3.6)} km/h`}</>
                  : <span className="error">Sin señal GPS hoy</span>}
              </p>
              <p>{progreso(ruta)} paradas · {km(ruta.distancia_metros)} · {duracion(ruta.duracion_segundos)}</p>
              <ol>
                {ruta.paradas.map((p) => (
                  <li key={p.id}>
                    <div className="fila espacio">
                      {p.pedido_id ? <Link href={`/pedidos/${p.pedido_id}`}><strong>{p.titulo}</strong></Link> : <strong>⚑ {p.titulo}</strong>}
                      <EstadoBadge estado={p.estado} mapa={ESTADOS_PARADA} />
                    </div>
                    <small>{[p.direccion, p.distrito].filter(Boolean).join(', ')}</small>
                    {p.pedido_id && <small>#{p.pedido_id} · {p.cobrar}{p.cobrar !== 'No Cobrar' && ` ${soles(p.total_pedido)}`}{p.cliente_telefono && ` · ${p.cliente_telefono}`}</small>}
                    {p.completada_en && <small>{ESTADOS_PARADA[p.estado].label} {fechaHora(p.completada_en)}{p.nota && ` — ${p.nota}`}</small>}
                  </li>
                ))}
              </ol>
              <Link href={`/rutas/${ruta.id}`}>Editar ruta</Link>
            </>
          ) : (
            <>
              <h3>Resumen del día</h3>
              <table>
                <thead><tr><th>Conductor</th><th>Avance</th><th>GPS</th><th>Estado</th></tr></thead>
                <tbody>
                  {rutas.map((r) => (
                    <tr key={r.id} className="clic" onClick={() => setSeleccion(r.id)}>
                      <td><span className="punto" style={{ background: color(r.id) }} /> {r.repartidor_nombre}</td>
                      <td>{progreso(r)}</td>
                      <td>{r.posicion ? hace(r.posicion.registrado_en) : '—'}</td>
                      <td><EstadoBadge estado={r.estado} mapa={ESTADOS_RUTA} /></td>
                    </tr>
                  ))}
                  {!rutas.length && <tr><td colSpan={4}>No hay rutas para esta fecha. <Link href="/rutas">Planificar</Link></td></tr>}
                </tbody>
              </table>
              <p>Pedidos sin rutear: <strong>{datos.sinRuta.length}</strong></p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
