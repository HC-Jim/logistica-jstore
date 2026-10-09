'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi, usuariosApi, vehiculosApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { useCatalogos } from '../context/CatalogosContext';
import { ESTADOS, ESTADOS_RUTA, fechaCorta, hoyISO, km, VEHICULOS } from '../utils/format';

const VACIA = { vehiculo_id: '', repartidor_id: '', asistente_id: '' };

/** Tarjeta de una ruta abierta: equipo, avance y lista de pedidos con su estado. */
function TarjetaRuta({ ruta }) {
  const v = VEHICULOS[ruta.vehiculo_tipo];
  const avance = ruta.total_paradas ? Math.round((ruta.paradas_atendidas / ruta.total_paradas) * 100) : 0;
  return (
    <section className={`tarjeta ruta-slot ruta-${ruta.estado}`}>
      <div className="fila espacio">
        <h3>Ruta {ruta.numero}</h3>
        <EstadoBadge estado={ruta.estado} mapa={ESTADOS_RUTA} />
      </div>
      <p className="ruta-equipo">
        {v ? `${v.icono} ${ruta.vehiculo_nombre}` : <span className="error">Sin vehículo</span>}
        <br />
        👤 {ruta.repartidor_nombre ?? <span className="error">Sin conductor</span>}
        {ruta.asistente_nombre && <> · 🧑‍🤝‍🧑 {ruta.asistente_nombre}</>}
      </p>
      <div className="barra-avance" title={`${avance}% atendido`}><span style={{ width: `${avance}%` }} /></div>
      <small>
        {ruta.completadas} entregados · {ruta.incidencias} incidencias · {ruta.pendientes} pendientes
        {ruta.distancia_metros ? ` · ${km(ruta.distancia_metros)}` : ''}
      </small>
      <ol className="ruta-pedidos">
        {ruta.paradas.map((p) => (
          <li key={p.id}>
            <span>{p.pedido_id ? <Link href={`/pedidos/${p.pedido_id}`}>{p.titulo}</Link> : <>⚑ {p.titulo}</>}
              <small>{p.distrito}</small></span>
            {/* en esta ruta: entregado / incidencia quedan como historial aunque el pedido siga en otra ruta */}
            {p.pedido_id
              ? <EstadoBadge estado={p.estado === 'completada' ? 'entregado' : p.estado === 'incidencia' ? 'incidencia' : p.estado_pedido} mapa={ESTADOS} />
              : <small>{p.estado}</small>}
          </li>
        ))}
        {!ruta.paradas.length && <li className="vacio">Sin pedidos todavía</li>}
      </ol>
      <div className="fila">
        <Link className="btn" href={`/rutas/${ruta.id}`}>Abrir ruta</Link>
        {ruta.mensajes > 0 && <small>💬 {ruta.mensajes} mensaje(s)</small>}
      </div>
    </section>
  );
}

/** Ruta del día aún no abierta: se elige vehículo y equipo. */
function RutaPorAbrir({ numero, vehiculos, conductores, auxiliares, ocupados, onAbrir }) {
  const [form, setForm] = useState(VACIA);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const num = (v) => (v ? Number(v) : null);

  async function abrir(e) {
    e.preventDefault();
    setError('');
    try {
      await onAbrir({ numero, vehiculo_id: num(form.vehiculo_id), repartidor_id: num(form.repartidor_id), asistente_id: num(form.asistente_id) });
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  return (
    <form className="tarjeta ruta-slot ruta-vacia" onSubmit={abrir}>
      <h3>Ruta {numero}</h3>
      <small>Sin abrir</small>
      <label>Vehículo
        <select value={form.vehiculo_id} onChange={set('vehiculo_id')}>
          <option value="">— Elegir —</option>
          {vehiculos.map((v) => (
            <option key={v.id} value={v.id} disabled={ocupados.vehiculos.has(v.id)}>
              {VEHICULOS[v.tipo]?.icono} {v.nombre}{v.placa ? ` (${v.placa})` : ''}{ocupados.vehiculos.has(v.id) ? ' — en otra ruta' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>Conductor
        <select value={form.repartidor_id} onChange={set('repartidor_id')}>
          <option value="">— Asignar después —</option>
          {conductores.map((u) => <option key={u.id} value={u.id}>{u.nombre}{ocupados.personas.has(u.id) ? ' (ya tiene ruta)' : ''}</option>)}
        </select>
      </label>
      <label>Auxiliar logístico
        <select value={form.asistente_id} onChange={set('asistente_id')}>
          <option value="">— Sin auxiliar —</option>
          {auxiliares.filter((u) => String(u.id) !== form.repartidor_id).map((u) => (
            <option key={u.id} value={u.id}>{u.nombre}{ocupados.personas.has(u.id) ? ' (ya tiene ruta)' : ''}</option>
          ))}
        </select>
      </label>
      {error && <small className="error">{error}</small>}
      <button>Abrir Ruta {numero}</button>
    </form>
  );
}

export default function Rutas() {
  const router = useRouter();
  const { catalogos } = useCatalogos();
  const [fecha, setFecha] = useState(hoyISO());
  const [rutas, setRutas] = useState([]);
  const [sinRuta, setSinRuta] = useState([]);
  const [extra, setExtra] = useState(0); // rutas adicionales a las de por defecto
  const [vehiculos, setVehiculos] = useState([]);
  const [conductores, setConductores] = useState([]);
  const [auxiliares, setAuxiliares] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    vehiculosApi.listar({ activos: true }).then(setVehiculos).catch(() => {});
    usuariosApi.listar({ rol: 'repartidor', activos: true }).then(setConductores).catch(() => {});
    usuariosApi.listar({ rol: 'auxiliar,repartidor', activos: true }).then(setAuxiliares).catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    try {
      const [lista, sr] = await Promise.all([rutasApi.listar(fecha), rutasApi.pedidosSinRuta(fecha)]);
      // con sus paradas para mostrar los pedidos de cada ruta
      setRutas(await Promise.all(lista.map((r) => rutasApi.obtener(r.id))));
      setSinRuta(sr);
      setError('');
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [fecha]);
  useEffect(() => { setExtra(0); cargar(); }, [cargar]);

  async function abrir(datos) {
    const ruta = await rutasApi.crear({ fecha, ...datos });
    router.push(`/rutas/${ruta.id}`);
  }

  const porDefecto = catalogos?.rutasPorDefecto ?? 3;
  const maxNumero = Math.max(porDefecto, ...rutas.map((r) => r.numero)) + extra;
  const numeros = Array.from({ length: maxNumero }, (_, i) => i + 1);
  const porNumero = new Map(rutas.map((r) => [r.numero, r]));
  const ocupados = {
    vehiculos: new Set(rutas.map((r) => r.vehiculo_id).filter(Boolean)),
    personas: new Set(rutas.flatMap((r) => [r.repartidor_id, r.asistente_id]).filter(Boolean)),
  };
  const pendientesDia = rutas.reduce((s, r) => s + r.pendientes, 0);
  const esPasado = fecha < hoyISO();

  return (
    <>
      <div className="encabezado">
        <h2>Rutas del {fechaCorta(fecha)}</h2>
        <div className="fila">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Link className="btn btn-sec" href="/rutas/historial">Historial de rutas</Link>
          <Link className="btn btn-sec" href={`/monitoreo?fecha=${fecha}`}>Monitoreo</Link>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {esPasado && (pendientesDia > 0 || sinRuta.length > 0) && (
        <p className="alerta">
          ⚠ Este día ya pasó y quedaron <strong>{pendientesDia + sinRuta.length}</strong> pedido(s) sin cerrar.
          Márcalos como entregados, reprográmalos o cancélalos.
        </p>
      )}

      <div className="kpis">
        <div className="kpi"><small>Rutas abiertas</small><strong>{rutas.length}</strong></div>
        <div className={`kpi ${sinRuta.length ? 'kpi-alerta' : ''}`}><small>Pedidos sin rutear</small><strong>{sinRuta.length}</strong></div>
        <div className="kpi"><small>Pendientes en ruta</small><strong>{pendientesDia}</strong></div>
        <div className="kpi"><small>Entregados</small><strong>{rutas.reduce((s, r) => s + r.completadas, 0)}</strong></div>
      </div>

      <div className="grid-rutas">
        {numeros.map((n) => (porNumero.has(n)
          ? <TarjetaRuta key={n} ruta={porNumero.get(n)} />
          : <RutaPorAbrir key={n} numero={n} vehiculos={vehiculos} conductores={conductores} auxiliares={auxiliares}
              ocupados={ocupados} onAbrir={abrir} />
        ))}
        <button className="tarjeta agregar-ruta" onClick={() => setExtra(extra + 1)}>
          + Agregar ruta<small>Ruta {maxNumero + 1}, para días con más demanda</small>
        </button>
      </div>

      {sinRuta.length > 0 && (
        <section className="tarjeta">
          <h3>Pedidos sin rutear ({sinRuta.length})</h3>
          <p>Abre una ruta y agrégalos desde su página.</p>
          <ul className="sin-rutear">
            {sinRuta.map((p) => (
              <li key={p.id}>
                <span><Link href={`/pedidos/${p.id}`}>#{p.id}</Link> {p.cliente_nombre}<small>{p.distrito} · {p.tipo_pedido}</small></span>
                {p.lat == null && <small className="error">sin ubicación</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
