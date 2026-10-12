'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import { TIPOS_SOLICITUD, fechaCorta, soles } from '../utils/format';

/** Dashboard de RRHH: personal, asistencia de hoy, ausentismo, planilla por área y vencimientos. */
export default function RrhhDashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { rrhhApi.dashboard().then(setD).catch((e) => setError(mensajeError(e))); }, []);

  if (error) return <p className="error">{error}</p>;
  if (!d) return <p>Cargando dashboard…</p>;
  const r = d.resumen;
  const vencidos = d.vencimientos.filter((v) => v.dias_restantes < 0).length;

  return (
    <>
      <div className="encabezado">
        <h2>Dashboard de RRHH</h2>
        <Link href="/rrhh/colaboradores/nuevo" className="btn">+ Nuevo colaborador</Link>
      </div>

      <div className="kpis">
        <Link href="/rrhh/colaboradores" className="tarjeta kpi"><small>Personal activo</small><strong>{r.activos}</strong><small>+{r.ingresos_mes} ingresos · −{r.ceses_mes} ceses este mes</small></Link>
        <Link href="/rrhh/asistencia" className="tarjeta kpi"><small>Asistieron hoy</small><strong>{d.hoy.asistieron}</strong><small>{d.hoy.tardanzas} tardanza(s) · {d.hoy.descanso} de descanso</small></Link>
        <div className={`tarjeta kpi ${d.hoy.sin_marcar ? 'kpi-alerta' : ''}`}><small>Sin marcar hoy</small><strong>{d.hoy.sin_marcar}</strong></div>
        <Link href="/rrhh/calendario" className="tarjeta kpi"><small>Ausentes hoy</small><strong>{d.hoy.ausentes}</strong><small>vacaciones, permisos, descansos</small></Link>
        <Link href="/rrhh/solicitudes" className={`tarjeta kpi ${r.pendientes ? 'kpi-alerta' : ''}`}><small>Solicitudes por aprobar</small><strong>{r.pendientes}</strong></Link>
        <Link href="/rrhh/reportes" className={`tarjeta kpi ${d.vencimientos.length ? 'kpi-alerta' : ''}`}><small>Vencimientos (30 días)</small><strong>{d.vencimientos.length}</strong><small>{vencidos} ya vencido(s)</small></Link>
        <div className="tarjeta kpi"><small>Ausentismo (30 días)</small><strong>{r.ausentismo} %</strong><small>faltas / días laborables</small></div>
        <div className="tarjeta kpi"><small>Rotación (12 meses)</small><strong>{r.rotacion} %</strong><small>{r.ceses_12m} cese(s)</small></div>
        <div className="tarjeta kpi"><small>Planilla mensual</small><strong>{soles(r.planilla)}</strong><small>+ EsSalud {soles(r.essalud)}</small></div>
      </div>

      {(r.sin_usuario > 0 || r.sin_horario > 0 || r.por_completar > 0) && (
        <p className="aviso">
          {r.por_completar > 0 && <><Link href="/rrhh/colaboradores">{r.por_completar} ficha(s) por completar</Link> (creadas desde los usuarios del sistema): falta DNI, contrato y fecha de ingreso real; hasta entonces no se controla su asistencia. </>}
          {r.sin_horario > 0 && `${r.sin_horario} colaborador(es) sin horario: no se les calcula tardanza ni horas extra. `}
          {r.sin_usuario > 0 && `${r.sin_usuario} sin usuario del sistema: no pueden marcar ni pedir vacaciones desde Mi espacio.`}
        </p>
      )}

      <div className="grid-graficos">
        <section className="tarjeta">
          <h3>Faltas, ausencias y tardanzas por día</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={d.porDia} margin={{ left: 0, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dia" tickFormatter={fechaCorta} fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip labelFormatter={fechaCorta} />
              <Legend />
              <Line type="monotone" dataKey="faltas" name="Faltas" stroke="#c53030" dot={false} />
              <Line type="monotone" dataKey="ausencias" name="Ausencias justificadas" stroke="#2b6cb0" dot={false} />
              <Line type="monotone" dataKey="tardanzas" name="Tardanzas" stroke="#d69e2e" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>
        <section className="tarjeta">
          <h3>Personal y planilla por área</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={d.porArea} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" allowDecimals={false} fontSize={12} />
              <YAxis type="category" dataKey="nombre" width={110} fontSize={12} />
              <Tooltip formatter={(v, n) => (n === 'Planilla' ? soles(v) : v)} />
              <Bar dataKey="cantidad" name="Personas" fill="#2b6cb0" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <table>
            <tbody>
              {d.porArea.map((a) => <tr key={a.nombre}><td>{a.nombre}</td><td className="num">{a.cantidad}</td><td className="num">{soles(a.planilla)}</td></tr>)}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid-graficos">
        <section className="tarjeta">
          <div className="fila espacio"><h3>⏰ Vencimientos próximos</h3><Link href="/rrhh/reportes">Reporte →</Link></div>
          <table>
            <thead><tr><th>Colaborador</th><th>Concepto</th><th>Vence</th></tr></thead>
            <tbody>
              {d.vencimientos.map((v, i) => (
                <tr key={i}>
                  <td><Link href={`/rrhh/colaboradores/${v.colaborador_id}`}>{v.colaborador}</Link></td><td>{v.concepto}</td>
                  <td className={v.dias_restantes < 0 ? 'error' : v.dias_restantes <= 15 ? 'pendiente-texto' : ''}>
                    {fechaCorta(v.vence)} ({v.dias_restantes < 0 ? `venció hace ${-v.dias_restantes} d` : `en ${v.dias_restantes} d`})
                  </td>
                </tr>
              ))}
              {!d.vencimientos.length && <tr><td colSpan={3}>Nada vence en los próximos 30 días.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="tarjeta">
          <h3>Hoy</h3>
          <p><strong>Ausentes:</strong></p>
          <ul className="historial">
            {d.ausentesHoy.map((a) => <li key={a.id}>{TIPOS_SOLICITUD[a.tipo].icono} {a.colaborador} <small>· {TIPOS_SOLICITUD[a.tipo].label} hasta {fechaCorta(a.hasta)}</small></li>)}
            {!d.ausentesHoy.length && <li><small>Nadie.</small></li>}
          </ul>
          <p><strong>Aún sin marcar:</strong></p>
          <ul className="historial">
            {d.sinMarcar.map((x) => <li key={x.colaborador_id}>{x.colaborador} <small>· {x.area}</small></li>)}
            {!d.sinMarcar.length && <li><small>Nadie.</small></li>}
          </ul>
          {d.cumpleanios.length > 0 && (
            <>
              <p><strong>🎂 Cumpleaños del mes:</strong></p>
              <ul className="historial">
                {d.cumpleanios.map((c) => <li key={c.id}>{c.dia} — {c.colaborador} <small>· {c.area}</small></li>)}
              </ul>
            </>
          )}
        </section>
      </div>

      {d.pendientes.length > 0 && (
        <section className="tarjeta">
          <div className="fila espacio"><h3>Solicitudes por aprobar</h3><Link href="/rrhh/solicitudes">Ver todas →</Link></div>
          <table>
            <tbody>
              {d.pendientes.map((s) => (
                <tr key={s.id}>
                  <td>{s.colaborador}</td><td>{TIPOS_SOLICITUD[s.tipo].icono} {TIPOS_SOLICITUD[s.tipo].label}</td>
                  <td>{fechaCorta(s.desde)} – {fechaCorta(s.hasta)}</td><td className="num">{s.dias} d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
