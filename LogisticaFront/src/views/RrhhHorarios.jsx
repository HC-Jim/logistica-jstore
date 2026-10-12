'use client';

import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import { DIAS_SEMANA, fechaCorta } from '../utils/format';

const VACIO = { id: null, nombre: '', hora_entrada: '08:00', hora_salida: '17:00', tolerancia_min: 5, refrigerio_min: 60, dias: [1, 2, 3, 4, 5, 6] };

/** Horarios de trabajo (entrada, salida, tolerancia, refrigerio, días) y feriados. */
export default function RrhhHorarios() {
  const [horarios, setHorarios] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [feriados, setFeriados] = useState([]);
  const [feriado, setFeriado] = useState({ fecha: '', nombre: '' });
  const [error, setError] = useState('');

  useEffect(() => { rrhhApi.horarios().then(setHorarios).catch((e) => setError(mensajeError(e))); }, []);
  useEffect(() => { rrhhApi.feriados(anio).then(setFeriados).catch((e) => setError(mensajeError(e))); }, [anio]);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    try {
      const { id, ...body } = form;
      setHorarios(await rrhhApi.guardarHorario(id, body));
      setForm(VACIO);
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  async function alternar(h) {
    try {
      setHorarios(await rrhhApi.guardarHorario(h.id, { ...h, activo: !h.activo }));
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function agregarFeriado(e) {
    e.preventDefault();
    try {
      await rrhhApi.guardarFeriado(feriado);
      setFeriado({ fecha: '', nombre: '' });
      setFeriados(await rrhhApi.feriados(anio));
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function quitarFeriado(f) {
    if (!confirm(`¿Quitar el feriado ${f.nombre}?`)) return;
    try {
      await rrhhApi.eliminarFeriado(f.fecha);
      setFeriados(feriados.filter((x) => x.fecha !== f.fecha));
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  const alternarDia = (d) => setForm({ ...form, dias: form.dias.includes(d) ? form.dias.filter((x) => x !== d) : [...form.dias, d].sort() });

  return (
    <>
      <h2>Horarios y feriados</h2>
      <form className="tarjeta form-grid" onSubmit={guardar}>
        <h3 className="ancho">{form.id ? `Editar ${form.nombre}` : 'Nuevo horario'}</h3>
        <label>Nombre *<input required maxLength={60} placeholder="Ej. Almacén L-S" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
        <label>Entrada *<input type="time" required value={form.hora_entrada} onChange={(e) => setForm({ ...form, hora_entrada: e.target.value })} /></label>
        <label>Salida *<input type="time" required value={form.hora_salida} onChange={(e) => setForm({ ...form, hora_salida: e.target.value })} /></label>
        <label>Tolerancia (min)<input type="number" min={0} max={120} value={form.tolerancia_min} onChange={(e) => setForm({ ...form, tolerancia_min: e.target.value })} /></label>
        <label>Refrigerio (min)<input type="number" min={0} max={240} value={form.refrigerio_min} onChange={(e) => setForm({ ...form, refrigerio_min: e.target.value })} /></label>
        <div className="ancho fila">
          <span>Días de trabajo:</span>
          {DIAS_SEMANA.map((d, i) => (
            <label key={d} className="check"><input type="checkbox" checked={form.dias.includes(i + 1)} onChange={() => alternarDia(i + 1)} /> {d}</label>
          ))}
        </div>
        {error && <p className="error ancho">{error}</p>}
        <div className="fila ancho">
          <button>{form.id ? 'Guardar' : 'Agregar'}</button>
          {form.id && <button type="button" className="btn-sec" onClick={() => setForm(VACIO)}>Cancelar</button>}
        </div>
        <small className="ancho">Pasada la tolerancia, la tardanza se cuenta desde la hora de entrada. Las horas extra son lo trabajado por encima de la jornada (salida − entrada − refrigerio); en días de descanso o feriados todo lo trabajado es extra.</small>
      </form>

      <section className="tarjeta">
        <table>
          <thead><tr><th>Horario</th><th>Entrada – salida</th><th>Días</th><th className="num">Tolerancia</th><th className="num">Refrigerio</th><th className="num">Personas</th><th /></tr></thead>
          <tbody>
            {horarios.map((h) => (
              <tr key={h.id} className={h.activo ? '' : 'inactivo'}>
                <td><strong>{h.nombre}</strong></td><td>{h.hora_entrada} – {h.hora_salida}</td>
                <td>{h.dias.map((d) => DIAS_SEMANA[d - 1]).join(', ')}</td>
                <td className="num">{h.tolerancia_min} min</td><td className="num">{h.refrigerio_min} min</td><td className="num">{h.colaboradores}</td>
                <td className="acciones">
                  <button className="btn-sec" onClick={() => setForm({ ...h })}>Editar</button>
                  <button className={h.activo ? 'btn-peligro' : 'btn-sec'} onClick={() => alternar(h)}>{h.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <div className="fila espacio">
          <h3>Feriados</h3>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[anio - 1, anio, anio + 1].map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <form className="fila filtros" onSubmit={agregarFeriado}>
          <input type="date" required value={feriado.fecha} onChange={(e) => setFeriado({ ...feriado, fecha: e.target.value })} />
          <input className="crece" required maxLength={80} placeholder="Nombre (p. ej. feriado regional o día no laborable)" value={feriado.nombre} onChange={(e) => setFeriado({ ...feriado, nombre: e.target.value })} />
          <button>Agregar</button>
        </form>
        <table>
          <tbody>
            {feriados.map((f) => (
              <tr key={f.fecha}>
                <td>{DIAS_SEMANA[(new Date(`${f.fecha}T12:00:00Z`).getUTCDay() + 6) % 7]} {fechaCorta(f.fecha)}</td><td>{f.nombre}</td>
                <td className="acciones"><button className="btn-peligro btn-mini" onClick={() => quitarFeriado(f)}>Quitar</button></td>
              </tr>
            ))}
            {!feriados.length && <tr><td>No hay feriados cargados para {anio}.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
