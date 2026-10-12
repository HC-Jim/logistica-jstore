'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import Dialogo from '../components/Dialogo';
import { useAuth } from '../context/AuthContext';
import { ESTADOS_SOLICITUD, TIPOS_SOLICITUD, fechaCorta, fechaHora } from '../utils/format';
import { tiene } from '../utils/roles';
import { Chip } from './MiEspacio';

/** Bandeja de solicitudes: el jefe aprueba las de su equipo; RRHH, todas. */
export default function RrhhSolicitudes() {
  const { usuario } = useAuth();
  const esRrhh = tiene(usuario, 'admin', 'rrhh');
  const [filtros, setFiltros] = useState({ estado: 'pendiente', tipo: '' });
  const [lista, setLista] = useState([]);
  const [dialogo, setDialogo] = useState(null); // { solicitud, estado }
  const [error, setError] = useState('');

  const cargar = () => rrhhApi.solicitudes(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)))
    .then(setLista).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, [filtros]); // eslint-disable-line react-hooks/exhaustive-deps

  async function aprobar(s) {
    try {
      await rrhhApi.resolverSolicitud(s.id, 'aprobada');
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  const esConductor = (s) => s.usuario_roles?.some((r) => ['repartidor', 'auxiliar'].includes(r));

  return (
    <>
      <div className="encabezado">
        <h2>Vacaciones y permisos</h2>
        <Link href="/rrhh/calendario">📅 Calendario del equipo</Link>
      </div>
      <div className="tarjeta fila filtros">
        <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS_SOLICITUD).map(([k, e]) => <option key={k} value={k}>{e.label}</option>)}
        </select>
        <select value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPOS_SOLICITUD).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        {esRrhh && <small>Para registrar un descanso médico o una licencia directamente, hazlo desde la ficha del colaborador.</small>}
      </div>
      {error && <p className="error">{error}</p>}

      <section className="tarjeta tabla-scroll">
        <table>
          <thead>
            <tr><th>Colaborador</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th className="num">Días</th><th>Motivo</th><th>Estado</th><th>Solicitada</th><th /></tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id}>
                <td>
                  {esRrhh ? <Link href={`/rrhh/colaboradores/${s.colaborador_id}`}>{s.colaborador}</Link> : s.colaborador}
                  <br /><small>{s.cargo} · {s.area}</small>
                  {esConductor(s) && s.estado === 'pendiente' && <div><small className="pendiente-texto">🚚 Revisa que su ruta tenga reemplazo</small></div>}
                </td>
                <td>{TIPOS_SOLICITUD[s.tipo].icono} {TIPOS_SOLICITUD[s.tipo].label}{!s.con_goce && <><br /><small>sin goce</small></>}</td>
                <td>{fechaCorta(s.desde)}</td><td>{fechaCorta(s.hasta)}</td><td className="num">{s.dias}</td>
                <td>
                  {s.motivo}
                  {s.documentos?.map((d) => (
                    <button key={d.id} className="btn-link-oscuro foto-mini" onClick={() => rrhhApi.verDocumento(d.id).catch((e) => alert(mensajeError(e)))}>📎 {d.nombre}</button>
                  ))}
                </td>
                <td>
                  <Chip estado={s.estado} mapa={ESTADOS_SOLICITUD} />
                  {s.resuelto_por_nombre && <><br /><small>{s.resuelto_por_nombre}{s.respuesta ? `: ${s.respuesta}` : ''}</small></>}
                </td>
                <td><small>{fechaHora(s.creado_en)}<br />{s.creado_por_nombre}</small></td>
                <td className="acciones">
                  {s.estado === 'pendiente' && s.usuario_id !== usuario.id && (
                    <>
                      <button className="btn-mini" onClick={() => aprobar(s)}>Aprobar</button>
                      <button className="btn-peligro btn-mini" onClick={() => setDialogo({ solicitud: s, estado: 'rechazada' })}>Rechazar</button>
                    </>
                  )}
                  {esRrhh && s.estado === 'aprobada' && (
                    <button className="btn-sec btn-mini" onClick={() => setDialogo({ solicitud: s, estado: 'anulada' })}>Anular</button>
                  )}
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={9}>No hay solicitudes{filtros.estado === 'pendiente' ? ' pendientes' : ''}.</td></tr>}
          </tbody>
        </table>
      </section>

      {dialogo && (
        <Dialogo
          titulo={`${dialogo.estado === 'rechazada' ? 'Rechazar' : 'Anular'} ${TIPOS_SOLICITUD[dialogo.solicitud.tipo].label.toLowerCase()} de ${dialogo.solicitud.colaborador}`}
          campos={[{ nombre: 'respuesta', etiqueta: 'Motivo', tipo: 'textarea', requerido: true }]}
          textoBoton={dialogo.estado === 'rechazada' ? 'Rechazar' : 'Anular'}
          peligro
          onAceptar={async ({ respuesta }) => { await rrhhApi.resolverSolicitud(dialogo.solicitud.id, dialogo.estado, respuesta); cargar(); }}
          onCerrar={() => setDialogo(null)}
        />
      )}
    </>
  );
}
