'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rutasApi, usuariosApi, vehiculosApi } from '../api/services';
import EstadoBadge from '../components/EstadoBadge';
import { ESTADOS_RUTA, fechaCorta, hoyISO, km, VEHICULOS } from '../utils/format';

const haceDias = (n) => {
  const d = new Date(`${hoyISO()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export default function RutasHistorial() {
  const [filtros, setFiltros] = useState({ desde: haceDias(30), hasta: hoyISO(), numero: '', repartidor_id: '', vehiculo_id: '', estado: '' });
  const [rutas, setRutas] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    usuariosApi.listar({ rol: 'repartidor,auxiliar' }).then(setPersonas).catch(() => {});
    vehiculosApi.listar().then(setVehiculos).catch(() => {});
  }, []);

  useEffect(() => {
    setCargando(true);
    const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
    rutasApi.historial(params)
      .then((r) => { setRutas(r); setError(''); })
      .catch((e) => setError(mensajeError(e)))
      .finally(() => setCargando(false));
  }, [filtros]);

  const f = (k) => ({ value: filtros[k], onChange: (e) => setFiltros({ ...filtros, [k]: e.target.value }) });
  const total = (k) => rutas.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const efectividad = total('completadas') + total('incidencias')
    ? Math.round((total('completadas') / (total('completadas') + total('incidencias'))) * 100)
    : null;

  return (
    <>
      <div className="encabezado">
        <h2>Historial de rutas</h2>
        <Link href="/rutas">← Rutas del día</Link>
      </div>

      <section className="tarjeta">
        <div className="filtros">
          <label>Desde<input type="date" {...f('desde')} /></label>
          <label>Hasta<input type="date" {...f('hasta')} /></label>
          <select {...f('numero')}>
            <option value="">Todas las rutas</option>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Ruta {n}</option>)}
          </select>
          <select {...f('repartidor_id')}>
            <option value="">Todo el personal</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select {...f('vehiculo_id')}>
            <option value="">Todos los vehículos</option>
            {vehiculos.map((v) => <option key={v.id} value={v.id}>{VEHICULOS[v.tipo]?.icono} {v.nombre}</option>)}
          </select>
          <select {...f('estado')}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS_RUTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {error && <p className="error">{error}</p>}

        <div className="kpis" style={{ marginTop: 14 }}>
          <div className="kpi"><small>Rutas</small><strong>{rutas.length}</strong></div>
          <div className="kpi"><small>Pedidos llevados</small><strong>{total('pedidos')}</strong></div>
          <div className="kpi"><small>Entregados</small><strong>{total('completadas')}</strong></div>
          <div className="kpi"><small>Incidencias</small><strong>{total('incidencias')}</strong></div>
          <div className="kpi"><small>Efectividad</small><strong>{efectividad == null ? '—' : `${efectividad}%`}</strong></div>
          <div className={`kpi ${total('pendientes') ? 'kpi-alerta' : ''}`}><small>Pendientes sin cerrar</small><strong>{total('pendientes')}</strong></div>
        </div>

        <div className="tabla-scroll">
          <table>
            <thead>
              <tr><th>Fecha</th><th>Ruta</th><th>Vehículo</th><th>Conductor</th><th>Auxiliar</th>
                <th>Pedidos</th><th>Entregados</th><th>Incid.</th><th>Pend.</th><th>Km</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {rutas.map((r) => (
                <tr key={r.id} className={r.pendientes > 0 && r.fecha < hoyISO() ? 'fila-error' : ''}>
                  <td>{fechaCorta(r.fecha)}</td>
                  <td><Link href={`/rutas/${r.id}`}><strong>Ruta {r.numero}</strong></Link>{r.mensajes > 0 && <small>💬 {r.mensajes}</small>}</td>
                  <td>{r.vehiculo_nombre ? `${VEHICULOS[r.vehiculo_tipo]?.icono} ${r.vehiculo_nombre}` : '—'}</td>
                  <td>{r.repartidor_nombre ?? '—'}</td>
                  <td>{r.asistente_nombre ?? '—'}</td>
                  <td>{r.pedidos}</td>
                  <td>{r.completadas}</td>
                  <td>{r.incidencias}</td>
                  <td>{r.pendientes}</td>
                  <td>{r.distancia_metros ? km(r.distancia_metros) : '—'}</td>
                  <td><EstadoBadge estado={r.estado} mapa={ESTADOS_RUTA} /></td>
                </tr>
              ))}
              {!cargando && !rutas.length && <tr><td colSpan={11}>No hay rutas con estos filtros</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
