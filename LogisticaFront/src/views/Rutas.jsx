'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi, usuariosApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { ESTADOS_RUTA, hoyISO, km } from '../utils/format';

export default function Rutas() {
  const router = useRouter();
  const [fecha, setFecha] = useState(hoyISO());
  const [rutas, setRutas] = useState([]);
  const [sinRuta, setSinRuta] = useState([]);
  const [repartidores, setRepartidores] = useState([]);
  const [nueva, setNueva] = useState({ nombre: '', repartidor_id: '', asistente_id: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    usuariosApi.listar({ rol: 'repartidor', activos: true }).then(setRepartidores).catch(() => {});
  }, []);

  const cargar = useCallback(() => {
    Promise.all([rutasApi.listar(fecha), rutasApi.pedidosSinRuta(fecha)])
      .then(([r, s]) => { setRutas(r); setSinRuta(s); setError(''); })
      .catch((e) => setError(mensajeError(e)));
  }, [fecha]);
  useEffect(cargar, [cargar]);

  async function crear(e) {
    e.preventDefault();
    try {
      const ruta = await rutasApi.crear({
        fecha,
        nombre: nueva.nombre || null,
        repartidor_id: Number(nueva.repartidor_id),
        asistente_id: nueva.asistente_id ? Number(nueva.asistente_id) : null,
      });
      router.push(`/rutas/${ruta.id}`);
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  const sinUbicacion = sinRuta.filter((p) => p.lat == null).length;

  return (
    <>
      <div className="encabezado">
        <h2>Planificación de rutas</h2>
        <div className="fila">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Link className="btn btn-sec" href={`/monitoreo?fecha=${fecha}`}>Ver monitoreo</Link>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="kpis">
        <div className="kpi"><small>Rutas del día</small><strong>{rutas.length}</strong></div>
        <div className="kpi"><small>Pedidos sin rutear</small><strong>{sinRuta.length}</strong></div>
        <div className={`kpi ${sinUbicacion ? 'kpi-alerta' : ''}`}><small>Sin ubicación en el mapa</small><strong>{sinUbicacion}</strong></div>
      </div>

      <section className="tarjeta">
        <h3>Rutas del {fecha}</h3>
        <table>
          <thead><tr><th>Ruta</th><th>Repartidor</th><th>Asistente</th><th>Paradas</th><th>Distancia</th><th>Estado</th></tr></thead>
          <tbody>
            {rutas.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/rutas/${r.id}`}><strong>{r.nombre || `Ruta #${r.id}`}</strong></Link></td>
                <td>{r.repartidor_nombre}</td>
                <td>{r.asistente_nombre || '—'}</td>
                <td>{r.paradas_atendidas}/{r.total_paradas}</td>
                <td>{km(r.distancia_metros)}</td>
                <td><EstadoBadge estado={r.estado} mapa={ESTADOS_RUTA} /></td>
              </tr>
            ))}
            {!rutas.length && <tr><td colSpan={6}>Todavía no hay rutas para esta fecha</td></tr>}
          </tbody>
        </table>

        <form className="fila nueva-ruta" onSubmit={crear}>
          <strong>Nueva ruta:</strong>
          <input placeholder="Nombre (opcional, ej. Sur)" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} />
          <select required value={nueva.repartidor_id} onChange={(e) => setNueva({ ...nueva, repartidor_id: e.target.value })}>
            <option value="">Repartidor…</option>
            {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
          <select value={nueva.asistente_id} onChange={(e) => setNueva({ ...nueva, asistente_id: e.target.value })}>
            <option value="">Sin asistente</option>
            {repartidores.filter((r) => String(r.id) !== nueva.repartidor_id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
          <button>Crear y planificar</button>
        </form>
        {!repartidores.length && <small>No hay usuarios con rol repartidor. Créalos en Usuarios.</small>}
      </section>
    </>
  );
}
