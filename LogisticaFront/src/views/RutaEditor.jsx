'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi, usuariosApi, vehiculosApi } from '../api/services';
import ChatRuta from '../components/ChatRuta';
import EstadoBadge from '../components/EstadoBadge';
import { AjustarVista, Mapa, MarcadorNumero, Polilinea } from '../components/maps';
import { useCatalogos } from '../context/CatalogosContext';
import { duracion, ESTADOS_PARADA, ESTADOS_RUTA, fechaCorta, km, soles, VEHICULOS } from '../utils/format';

/** Convierte una parada guardada en un elemento editable de la lista. */
const desdeParada = (p) => ({
  clave: `p${p.id}`,
  id: p.id,
  pedido_id: p.pedido_id,
  titulo: p.titulo,
  direccion: [p.direccion, p.distrito].filter(Boolean).join(', '),
  lat: p.lat,
  lng: p.lng,
  estado: p.estado,
  total: p.total_pedido,
  cobrar: p.cobrar,
});

const desdePedido = (p) => ({
  clave: `n${p.id}`,
  pedido_id: p.id,
  titulo: p.cliente_nombre,
  direccion: [p.direccion, p.distrito].filter(Boolean).join(', '),
  lat: p.lat,
  lng: p.lng,
  estado: 'pendiente',
  total: p.total_pedido,
  cobrar: p.cobrar,
});

export default function RutaEditor() {
  const { id } = useParams();
  const router = useRouter();
  const { catalogos } = useCatalogos();
  const [ruta, setRuta] = useState(null);
  const [lista, setLista] = useState([]);
  const [sinRuta, setSinRuta] = useState([]);
  const [repartidores, setRepartidores] = useState([]); // conductores
  const [auxiliares, setAuxiliares] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [sucio, setSucio] = useState(false);
  const [libre, setLibre] = useState(null); // acción libre en preparación
  const [trabajando, setTrabajando] = useState('');
  const [error, setError] = useState('');

  const aplicar = useCallback((r) => {
    setRuta(r);
    setLista(r.paradas.map(desdeParada));
    setSucio(false);
    return rutasApi.pedidosSinRuta(r.fecha).then(setSinRuta);
  }, []);

  useEffect(() => {
    rutasApi.obtener(id).then(aplicar).catch((e) => setError(mensajeError(e)));
    usuariosApi.listar({ rol: 'repartidor', activos: true }).then(setRepartidores).catch(() => {});
    usuariosApi.listar({ rol: 'auxiliar,repartidor', activos: true }).then(setAuxiliares).catch(() => {});
    vehiculosApi.listar({ activos: true }).then(setVehiculos).catch(() => {});
  }, [id, aplicar]);

  // Avisar antes de salir con cambios sin guardar
  useEffect(() => {
    if (!sucio) return;
    const aviso = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sucio]);

  async function accion(nombre, fn) {
    setTrabajando(nombre);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setTrabajando('');
    }
  }

  const cambiar = (nueva) => { setLista(nueva); setSucio(true); };
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    const copia = [...lista];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    cambiar(copia);
  };
  const enLista = new Set(lista.map((p) => p.pedido_id).filter(Boolean));
  const disponibles = sinRuta.filter((p) => !enLista.has(p.id));
  const agregar = (p) => cambiar([...lista, desdePedido(p)]);

  // Formato que espera la API: parada existente, pedido nuevo o acción libre
  const payload = () => lista.map((p) => (p.id ? { id: p.id }
    : p.pedido_id ? { pedido_id: p.pedido_id }
      : { descripcion: p.titulo, direccion: p.direccion, lat: p.lat, lng: p.lng }));
  const guardar = () => accion('guardar', async () => {
    await aplicar(await rutasApi.guardarParadas(id, payload()));
  });
  const trazar = (optimizar) => accion(optimizar ? 'optimizar' : 'trazar', async () => {
    if (sucio) await rutasApi.guardarParadas(id, payload());
    await aplicar(await rutasApi.trazar(id, optimizar));
  });
  const actualizarRuta = (cambios) => accion('ruta', async () => {
    await rutasApi.actualizar(id, cambios);
    const r = await rutasApi.obtener(id);
    setRuta(r);
  });
  const finalizar = () => {
    if (!confirm(`¿Finalizar la Ruta ${ruta.numero}? Ya no se podrá modificar.`)) return;
    accion('finalizar', async () => {
      await rutasApi.finalizar(id);
      setRuta(await rutasApi.obtener(id));
    });
  };
  const eliminar = () => {
    if (!confirm('¿Eliminar la ruta? Sus pedidos volverán a "sin rutear".')) return;
    accion('eliminar', async () => {
      await rutasApi.eliminar(id);
      router.push('/rutas');
    });
  };

  if (error && !ruta) return <p className="error">{error}</p>;
  if (!ruta || !catalogos) return <p>Cargando…</p>;

  const deposito = catalogos.deposito;
  const puntos = [deposito, ...lista, ...disponibles].filter((p) => p.lat != null).map((p) => ({ lat: p.lat, lng: p.lng }));
  const finalizada = ruta.estado === 'finalizada';

  return (
    <>
      <div className="encabezado">
        <h2>Ruta {ruta.numero} · {fechaCorta(ruta.fecha)} <EstadoBadge estado={ruta.estado} mapa={ESTADOS_RUTA} /></h2>
        <div className="fila">
          {!finalizada && (
            <button onClick={finalizar} disabled={!!trabajando || ruta.pendientes > 0}
              title={ruta.pendientes ? 'Primero entrega, reprograma o cancela los pedidos pendientes' : 'Cerrar la ruta del día'}>
              Finalizar ruta
            </button>
          )}
          <Link className="btn btn-sec" href={`/despacho/${ruta.id}`}>Hoja de ruta</Link>
          <Link href={`/monitoreo?fecha=${ruta.fecha}&ruta=${ruta.id}`}>Ver en monitoreo</Link>
          <Link href={`/rutas/historial`}>Historial</Link>
          <Link href="/rutas">← Rutas</Link>
        </div>
      </div>

      <section className="tarjeta fila">
        <label>Vehículo
          <select value={ruta.vehiculo_id ?? ''} disabled={finalizada}
            onChange={(e) => actualizarRuta({ vehiculo_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Sin vehículo</option>
            {vehiculos.map((v) => <option key={v.id} value={v.id}>{VEHICULOS[v.tipo]?.icono} {v.nombre}</option>)}
          </select>
        </label>
        <label>Conductor
          <select value={ruta.repartidor_id ?? ''} disabled={finalizada}
            onChange={(e) => actualizarRuta({ repartidor_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Sin conductor</option>
            {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        <label>Auxiliar logístico
          <select value={ruta.asistente_id ?? ''} disabled={finalizada}
            onChange={(e) => actualizarRuta({ asistente_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Sin auxiliar</option>
            {auxiliares.filter((r) => r.id !== ruta.repartidor_id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        <div className="kpi-mini"><small>Distancia</small><strong>{km(ruta.distancia_metros)}</strong></div>
        <div className="kpi-mini"><small>Tiempo est.</small><strong>{duracion(ruta.duracion_segundos)}</strong></div>
        <div className="kpi-mini"><small>A cobrar</small><strong>{soles(lista.filter((p) => p.cobrar && p.cobrar !== 'No Cobrar').reduce((s, p) => s + (p.total ?? 0), 0))}</strong></div>
        <span className="crece" />
        {ruta.paradas_atendidas === 0 && <button className="btn-peligro" onClick={eliminar}>Eliminar ruta</button>}
      </section>

      {error && <p className="error">{error}</p>}
      {!finalizada && ruta.pendientes > 0 && ruta.fecha < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()) && (
        <p className="alerta">⚠ Esta ruta es de un día anterior y tiene {ruta.pendientes} parada(s) pendientes. Ciérralas para finalizarla.</p>
      )}
      {libre?.marcando && <p className="aviso">Haz clic en el mapa para ubicar “{libre.titulo || 'la acción'}”.</p>}

      <div className="grid-ruta">
        <section className="tarjeta">
          <Mapa alto={600} onClick={(e) => {
            if (libre?.marcando && e.detail.latLng) setLibre({ ...libre, ...e.detail.latLng, marcando: false });
          }}>
            <AjustarVista puntos={puntos} />
            <MarcadorNumero position={deposito} texto="A" color="#1a202c" title={deposito.nombre} />
            {lista.map((p, i) => p.lat != null && (
              <MarcadorNumero key={p.clave} position={{ lat: p.lat, lng: p.lng }} texto={i + 1}
                color={p.estado === 'pendiente' ? '#2b6cb0' : ESTADOS_PARADA[p.estado].color}
                title={`${i + 1}. ${p.titulo}`} />
            ))}
            {!finalizada && disponibles.filter((p) => p.lat != null).map((p) => (
              <MarcadorNumero key={`d${p.id}`} position={{ lat: p.lat, lng: p.lng }} texto="+" color="#a0aec0"
                title={`Agregar: ${p.cliente_nombre} (${p.distrito ?? ''})`} onClick={() => agregar(p)} />
            ))}
            {libre?.lat != null && <MarcadorNumero position={{ lat: libre.lat, lng: libre.lng }} texto="★" color="#805ad5" />}
            {ruta.polyline && !sucio && <Polilinea codificada={ruta.polyline} />}
          </Mapa>
          <small className="ayuda">Azul: paradas de la ruta · Gris (+): pedidos sin rutear, clic para agregar · A: almacén</small>
        </section>

        <section className="tarjeta lista-paradas">
          <div className="fila">
            <button onClick={guardar} disabled={!sucio || !!trabajando || finalizada}>{trabajando === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
            <button className="btn-sec" onClick={() => trazar(true)} disabled={!lista.length || !!trabajando || finalizada}
              title="Google reordena las paradas pendientes para el recorrido más corto">
              {trabajando === 'optimizar' ? 'Optimizando…' : 'Optimizar orden'}
            </button>
            <button className="btn-sec" onClick={() => trazar(false)} disabled={!lista.length || !!trabajando}>
              {trabajando === 'trazar' ? 'Trazando…' : 'Trazar ruta'}
            </button>
          </div>
          {sucio && <small className="error">Cambios sin guardar</small>}

          <h3>Paradas ({lista.length})</h3>
          <p><strong>A</strong> · {deposito.nombre} (salida)</p>
          <ol>
            {lista.map((p, i) => (
              <li key={p.clave} className={p.estado !== 'pendiente' ? 'atendida' : ''}>
                <div className="fila espacio">
                  <span>
                    {p.pedido_id ? <Link href={`/pedidos/${p.pedido_id}`}><strong>{p.titulo}</strong></Link> : <strong>⚑ {p.titulo}</strong>}
                    {p.pedido_id && <small>#{p.pedido_id} · {p.cobrar} {p.cobrar !== 'No Cobrar' && soles(p.total)}</small>}
                  </span>
                  {p.estado !== 'pendiente' ? <EstadoBadge estado={p.estado} mapa={ESTADOS_PARADA} /> : !finalizada && (
                    <span className="botonera">
                      <button className="btn-mini btn-sec" onClick={() => mover(i, -1)} disabled={i === 0}>↑</button>
                      <button className="btn-mini btn-sec" onClick={() => mover(i, 1)} disabled={i === lista.length - 1}>↓</button>
                      <button className="btn-mini btn-peligro" onClick={() => cambiar(lista.filter((_, j) => j !== i))}>✕</button>
                    </span>
                  )}
                </div>
                <small>{p.direccion}</small>
              </li>
            ))}
          </ol>

          {!finalizada && (
            <>
              <h3>Agregar acción</h3>
              <div className="accion-libre">
                <input placeholder="Ej. Recoger en Almacén Guardatodo / Despacho para Falabella" value={libre?.titulo ?? ''}
                  onChange={(e) => setLibre({ ...libre, titulo: e.target.value })} />
                <input placeholder="Dirección (opcional)" value={libre?.direccion ?? ''}
                  onChange={(e) => setLibre({ ...libre, direccion: e.target.value })} />
                <div className="fila">
                  <button type="button" className="btn-sec" onClick={() => setLibre({ ...libre, marcando: true })}>
                    {libre?.lat != null ? 'Ubicación ✔ (cambiar)' : 'Marcar en el mapa'}
                  </button>
                  <button type="button" disabled={!libre?.titulo || libre?.lat == null}
                    onClick={() => { cambiar([...lista, { ...libre, clave: `l${Date.now()}`, estado: 'pendiente', marcando: undefined }]); setLibre(null); }}>
                    Agregar
                  </button>
                </div>
              </div>

              <h3>Pedidos sin rutear del día ({disponibles.length})</h3>
              <ul className="sin-rutear">
                {disponibles.map((p) => (
                  <li key={p.id}>
                    <span>
                      <Link href={`/pedidos/${p.id}`}>#{p.id}</Link> {p.cliente_nombre}
                      <small>{p.distrito} · {p.tipo_pedido}</small>
                    </span>
                    {p.lat == null
                      ? <small className="error">sin ubicación</small>
                      : <button className="btn-mini" onClick={() => agregar(p)}>Agregar</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      <section className="tarjeta">
        <h3>💬 Chat de la Ruta {ruta.numero}</h3>
        <ChatRuta rutaId={ruta.id} />
      </section>
    </>
  );
}
