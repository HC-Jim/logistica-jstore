'use client';

import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import { DIAS_SEMANA, TIPOS_SOLICITUD, fechaCorta, hoyISO } from '../utils/format';

const esConductor = (a) => a.usuario_roles?.some((r) => ['repartidor', 'auxiliar'].includes(r));

/** Quién falta cada día (vacaciones, permisos, descansos médicos, licencias) y feriados. */
export default function RrhhCalendario() {
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [datos, setDatos] = useState(null);
  const [soloReparto, setSoloReparto] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { rrhhApi.calendario(mes).then(setDatos).catch((e) => setError(mensajeError(e))); }, [mes]);

  const semanas = useMemo(() => {
    if (!datos) return [];
    const inicio = new Date(`${datos.desde}T12:00:00Z`);
    inicio.setUTCDate(inicio.getUTCDate() - ((inicio.getUTCDay() + 6) % 7)); // lunes de la primera semana
    const fin = new Date(`${datos.hasta}T12:00:00Z`);
    const lista = [];
    for (let d = inicio; d <= fin || (d.getUTCDay() + 6) % 7 !== 0; d.setUTCDate(d.getUTCDate() + 1)) {
      if ((d.getUTCDay() + 6) % 7 === 0) lista.push([]);
      lista.at(-1).push(d.toISOString().slice(0, 10));
    }
    return lista;
  }, [datos]);

  if (error) return <p className="error">{error}</p>;
  if (!datos) return <p>Cargando…</p>;
  const ausencias = datos.ausencias.filter((a) => !soloReparto || esConductor(a));
  const feriado = (f) => datos.feriados.find((x) => x.fecha === f)?.nombre;
  const hoy = hoyISO();

  return (
    <>
      <div className="encabezado">
        <h2>Calendario del equipo</h2>
        <div className="fila">
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          <label className="check"><input type="checkbox" checked={soloReparto} onChange={(e) => setSoloReparto(e.target.checked)} /> Solo conductores y auxiliares</label>
        </div>
      </div>
      <div className="leyenda fila">
        {Object.entries(TIPOS_SOLICITUD).map(([k, t]) => <span key={k}><span className="punto" style={{ background: t.color }} /> {t.label}</span>)}
        <span>· borde punteado = por aprobar · 🚚 conductor / auxiliar</span>
      </div>

      <section className="tarjeta calendario">
        {DIAS_SEMANA.map((d) => <div key={d} className="calendario-cabecera">{d}</div>)}
        {semanas.flat().map((f) => {
          const delMes = f.slice(0, 7) === mes;
          const del = ausencias.filter((a) => a.desde <= f && a.hasta >= f);
          const fer = feriado(f);
          return (
            <div key={f} className={`calendario-dia ${delMes ? '' : 'fuera'} ${fer ? 'feriado' : ''} ${f === hoy ? 'hoy' : ''}`}>
              <div className="fila espacio"><strong>{Number(f.slice(8))}</strong>{del.length > 0 && <small>{del.length} ausente{del.length === 1 ? '' : 's'}</small>}</div>
              {fer && <small className="calendario-feriado">🎌 {fer}</small>}
              {delMes && del.map((a) => (
                <div key={a.id} className={`calendario-ausencia ${a.estado === 'pendiente' ? 'pendiente' : ''}`}
                  style={{ borderColor: TIPOS_SOLICITUD[a.tipo].color, background: `${TIPOS_SOLICITUD[a.tipo].color}18` }}
                  title={`${a.colaborador} · ${TIPOS_SOLICITUD[a.tipo].label} del ${fechaCorta(a.desde)} al ${fechaCorta(a.hasta)}${a.estado === 'pendiente' ? ' (por aprobar)' : ''}`}>
                  {esConductor(a) && '🚚 '}{a.colaborador.split(' ')[0]} {a.colaborador.split(' ')[1]?.[0] ?? ''}.
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="tarjeta">
        <h3>Ausencias del mes</h3>
        <table>
          <thead><tr><th>Colaborador</th><th>Área</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th className="num">Días</th><th>Estado</th></tr></thead>
          <tbody>
            {ausencias.map((a) => (
              <tr key={a.id}>
                <td>{esConductor(a) && '🚚 '}{a.colaborador}<br /><small>{a.cargo}</small></td><td>{a.area}</td>
                <td>{TIPOS_SOLICITUD[a.tipo].icono} {TIPOS_SOLICITUD[a.tipo].label}</td>
                <td>{fechaCorta(a.desde)}</td><td>{fechaCorta(a.hasta)}</td><td className="num">{a.dias}</td>
                <td>{a.estado === 'pendiente' ? 'Por aprobar' : 'Aprobada'}</td>
              </tr>
            ))}
            {!ausencias.length && <tr><td colSpan={7}>Nadie falta este mes.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
