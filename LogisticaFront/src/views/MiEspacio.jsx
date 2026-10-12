'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import {
  DIAS_SEMANA, ESTADOS_DIA, ESTADOS_SOLICITUD, TIPOS_SOLICITUD, fechaCorta, hora, hoyISO, minutos,
} from '../utils/format';

const SOLICITUD_VACIA = { tipo: 'vacaciones', desde: '', hasta: '', con_goce: true, motivo: '' };

/** Posición del celular o la computadora (si el usuario no la permite, se marca sin ubicación). */
const ubicacion = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
});

const diasEntre = (a, b) => (a && b && b >= a ? Math.round((new Date(b) - new Date(a)) / 86400000) + 1 : 0);

export function Chip({ estado, mapa = ESTADOS_DIA }) {
  const e = mapa[estado];
  if (!e?.label) return null;
  return <span className="badge" style={{ background: `${e.color}22`, color: e.color }}>{e.label}</span>;
}

/** Mi espacio de RRHH: marcar asistencia, saldo de vacaciones, solicitudes y asistencia del mes. */
export default function MiEspacio() {
  const [mi, setMi] = useState(null);
  const [solicitudes, setSolicitudes] = useState([]);
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [asistencia, setAsistencia] = useState(null);
  const [form, setForm] = useState(SOLICITUD_VACIA);
  const [archivo, setArchivo] = useState(null);
  const [marcando, setMarcando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const cargar = () => rrhhApi.mi().then((d) => {
    setMi(d);
    if (d.colaborador) rrhhApi.misSolicitudes().then(setSolicitudes).catch((e) => setError(mensajeError(e)));
  }).catch((e) => setError(mensajeError(e)));
  useEffect(() => { cargar(); }, []);
  useEffect(() => {
    if (!mi?.colaborador) return;
    rrhhApi.miAsistencia(mes).then(setAsistencia).catch((e) => setError(mensajeError(e)));
  }, [mes, mi?.colaborador?.id]);

  if (error && !mi) return <p className="error">{error}</p>;
  if (!mi) return <p>Cargando…</p>;
  if (!mi.colaborador) {
    return (
      <>
        <h2>Mi espacio</h2>
        <div className="tarjeta aviso">Tu usuario todavía no está vinculado a una ficha de colaborador. Pide a Recursos Humanos que la vincule para marcar asistencia y pedir vacaciones o permisos.</div>
      </>
    );
  }

  const c = mi.colaborador;
  const v = mi.vacaciones;
  const marcas = mi.hoy.marcaciones;
  const siguiente = marcas.at(-1)?.tipo === 'entrada' ? 'salida' : 'entrada';
  const diasPedidos = diasEntre(form.desde, form.hasta);

  async function marcar() {
    setMarcando(true);
    setError('');
    setAviso('');
    try {
      const pos = await ubicacion();
      const m = await rrhhApi.marcar({ ...(pos ?? {}), origen: 'web' });
      setAviso(`${m.tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada a las ${hora(m.marcado_en)}${pos ? '' : ' (sin ubicación: el navegador no la permitió)'}`);
      cargar();
      rrhhApi.miAsistencia(mes).then(setAsistencia).catch(() => {});
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setMarcando(false);
    }
  }

  async function solicitar(e) {
    e.preventDefault();
    setError('');
    setAviso('');
    try {
      const s = await rrhhApi.solicitar(form);
      if (archivo) await rrhhApi.adjuntarMiSolicitud(s.id, archivo);
      setForm(SOLICITUD_VACIA);
      setArchivo(null);
      e.target.reset();
      setAviso('Solicitud enviada. Te avisaremos cuando la aprueben.');
      cargar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  async function anular(s) {
    if (!confirm('¿Anular esta solicitud?')) return;
    try {
      await rrhhApi.anularMiSolicitud(s.id);
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function adjuntar(s, file) {
    if (!file) return;
    try {
      await rrhhApi.adjuntarMiSolicitud(s.id, file);
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  const r = asistencia?.resumen;
  return (
    <>
      <div className="encabezado">
        <h2>Mi espacio</h2>
        <small>{c.nombre_completo} · {c.cargo} · {c.area}</small>
      </div>
      {aviso && <p className="aviso">{aviso}</p>}
      {error && <p className="error">{error}</p>}

      <div className="grid-graficos">
        <section className="tarjeta">
          <h3>🕘 Asistencia de hoy</h3>
          <p>
            {mi.horario
              ? <>Horario: <strong>{mi.horario.hora_entrada} – {mi.horario.hora_salida}</strong> ({mi.horario.dias.map((d) => DIAS_SEMANA[d - 1]).join(', ')}, tolerancia {mi.horario.tolerancia_min} min)</>
              : 'Sin horario asignado.'}
          </p>
          <button className="btn-marcar" onClick={marcar} disabled={marcando}>
            {marcando ? 'Registrando…' : siguiente === 'entrada' ? '▶ Marcar entrada' : '■ Marcar salida'}
          </button>
          <ul className="marcas-hoy">
            {marcas.map((m) => (
              <li key={m.id}>
                <strong>{m.tipo === 'entrada' ? 'Entrada' : m.tipo === 'salida' ? 'Salida' : 'Marca'}</strong> {hora(m.marcado_en)}
                <small> · {m.origen}{m.distancia_m != null ? ` · a ${(m.distancia_m / 1000).toFixed(1)} km del almacén` : ''}</small>
              </li>
            ))}
            {!marcas.length && <li><small>Aún no marcas hoy.</small></li>}
          </ul>
          <small>Conductores y auxiliares no necesitan marcar: el inicio y fin de turno se toman del GPS del app de reparto.</small>
        </section>

        <section className="tarjeta">
          <h3>🏖️ Mis vacaciones</h3>
          <div className="kpis kpis-compactos">
            <div className="kpi"><small>Saldo</small><strong>{v.saldo} días</strong></div>
            <div className="kpi"><small>Disponible para pedir</small><strong>{v.disponible}</strong></div>
            <div className="kpi"><small>Ganados ({v.anios_completos} año{v.anios_completos === 1 ? '' : 's'})</small><strong>{v.ganados}</strong></div>
            <div className="kpi"><small>Proporcional del año en curso</small><strong>{v.en_curso}</strong></div>
            <div className="kpi"><small>Gozados</small><strong>{v.gozados}</strong></div>
            <div className="kpi"><small>Programados · por aprobar</small><strong>{v.programados} · {v.pendientes}</strong></div>
          </div>
          <small>30 días por año de servicio (2,5 por mes). Ingreso: {fechaCorta(c.fecha_ingreso)}.</small>
        </section>
      </div>

      <form className="tarjeta form-grid" onSubmit={solicitar}>
        <h3 className="ancho">Nueva solicitud</h3>
        <label>Tipo
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value, con_goce: true })}>
            {Object.entries(TIPOS_SOLICITUD).map(([k, t]) => <option key={k} value={k}>{t.icono} {t.label}</option>)}
          </select>
        </label>
        <label>Desde *<input type="date" required value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value, hasta: form.hasta && form.hasta >= e.target.value ? form.hasta : e.target.value })} /></label>
        <label>Hasta *<input type="date" required min={form.desde} value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} /></label>
        {['permiso', 'licencia'].includes(form.tipo) && (
          <label>Goce de haber
            <select value={form.con_goce ? '1' : '0'} onChange={(e) => setForm({ ...form, con_goce: e.target.value === '1' })}>
              <option value="1">Con goce</option><option value="0">Sin goce (se descuenta)</option>
            </select>
          </label>
        )}
        <label className="ancho">Motivo {form.tipo !== 'vacaciones' && '*'}
          <input maxLength={500} required={form.tipo !== 'vacaciones'} value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
            placeholder={form.tipo === 'licencia' ? 'Paternidad, fallecimiento de un familiar…' : ''} />
        </label>
        {form.tipo !== 'vacaciones' && (
          <label>Sustento (PDF o foto){form.tipo === 'descanso_medico' && ' — certificado médico'}
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setArchivo(e.target.files[0] ?? null)} />
          </label>
        )}
        <div className="fila ancho">
          <button>Enviar solicitud</button>
          {diasPedidos > 0 && <small>{diasPedidos} día{diasPedidos === 1 ? '' : 's'} calendario{form.tipo === 'vacaciones' && diasPedidos > v.disponible ? ' · supera tu saldo disponible' : ''}</small>}
        </div>
      </form>

      <section className="tarjeta">
        <h3>Mis solicitudes</h3>
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>Tipo</th><th>Desde</th><th>Hasta</th><th className="num">Días</th><th>Motivo</th><th>Estado</th><th>Respuesta</th><th /></tr></thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.id}>
                  <td>{TIPOS_SOLICITUD[s.tipo].icono} {TIPOS_SOLICITUD[s.tipo].label}{!s.con_goce && <small> (sin goce)</small>}</td>
                  <td>{fechaCorta(s.desde)}</td><td>{fechaCorta(s.hasta)}</td><td className="num">{s.dias}</td>
                  <td>{s.motivo}{s.documentos?.map((d) => (
                    <button key={d.id} className="btn-link-oscuro foto-mini" onClick={() => rrhhApi.verDocumento(d.id).catch((e) => alert(mensajeError(e)))}>📎 {d.nombre}</button>
                  ))}</td>
                  <td><Chip estado={s.estado} mapa={ESTADOS_SOLICITUD} /></td>
                  <td><small>{s.respuesta}{s.resuelto_por_nombre && ` — ${s.resuelto_por_nombre}`}</small></td>
                  <td className="acciones">
                    {s.estado === 'pendiente' && <button className="btn-peligro btn-mini" onClick={() => anular(s)}>Anular</button>}
                    {s.tipo !== 'vacaciones' && ['pendiente', 'aprobada'].includes(s.estado) && (
                      <label className="btn-sec btn-mini adjuntar">📎 Adjuntar
                        <input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => adjuntar(s, e.target.files[0])} />
                      </label>
                    )}
                  </td>
                </tr>
              ))}
              {!solicitudes.length && <tr><td colSpan={8}>No tienes solicitudes.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta">
        <div className="fila espacio">
          <h3>Mi asistencia</h3>
          <input type="month" value={mes} max={hoyISO().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </div>
        {r && (
          <div className="resumen-reporte">
            <div><strong>{r.asistencias}</strong><small>Asistencias</small></div>
            <div className={r.faltas ? 'alerta' : ''}><strong>{r.faltas}</strong><small>Faltas</small></div>
            <div><strong>{r.tardanzas}</strong><small>Tardanzas ({r.minutos_tardanza} min)</small></div>
            <div><strong>{r.horas_extra}</strong><small>Horas extra</small></div>
            <div><strong>{r.vacaciones + r.descanso_medico + r.permisos_con_goce + r.permisos_sin_goce}</strong><small>Días de ausencia</small></div>
          </div>
        )}
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>Día</th><th>Estado</th><th>Entrada</th><th>Salida</th><th className="num">Tardanza</th><th className="num">Trabajado</th><th className="num">Extra</th></tr></thead>
            <tbody>
              {asistencia?.dias.filter((d) => d.estado !== 'futuro').map((d) => (
                <tr key={d.fecha}>
                  <td>{DIAS_SEMANA[(new Date(`${d.fecha}T12:00:00Z`).getUTCDay() + 6) % 7]} {fechaCorta(d.fecha)}</td>
                  <td><Chip estado={d.estado} />{d.feriado && <small> {d.feriado}</small>}{d.sin_salida && <small className="error"> sin salida</small>}</td>
                  <td>{d.entrada ? hora(d.entrada) : ''}</td><td>{d.salida ? hora(d.salida) : ''}</td>
                  <td className="num">{d.minutos_tardanza ? `${d.minutos_tardanza} min` : ''}</td>
                  <td className="num">{d.minutos_trabajados != null ? minutos(d.minutos_trabajados) : ''}</td>
                  <td className="num">{d.minutos_extra ? minutos(d.minutos_extra) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
