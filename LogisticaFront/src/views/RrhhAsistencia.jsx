'use client';

import Papa from 'papaparse';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { mensajeError } from '../api/client';
import { rrhhApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { DIAS_SEMANA, ESTADOS_DIA, fechaCorta, hora, hoyISO, minutos } from '../utils/format';
import { tiene } from '../utils/roles';
import { Chip } from './MiEspacio';

const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const COLUMNAS_RELOJ = {
  documento: ['documento', 'dni', 'nrodocumento', 'numerodocumento', 'codigo', 'ce'],
  fecha: ['fecha', 'dia'],
  hora: ['hora'],
  fecha_hora: ['fechahora', 'marcacion', 'datetime', 'tiempo'],
  tipo: ['tipo', 'evento', 'estado'],
};

/** "09/10/2026" o "2026-10-09" → "2026-10-09" */
function leerFecha(t) {
  const s = String(t ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}
/** "8:05", "08:05:33", "8:05 p. m." → "HH:MM" */
function leerHora(t) {
  const s = String(t ?? '').trim().toLowerCase();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return s;
  let h = Number(m[1]);
  if (/p\.?\s?m/.test(s) && h < 12) h += 12;
  if (/a\.?\s?m/.test(s) && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
function leerTipo(t) {
  const s = normalizar(t);
  if (['entrada', 'in', 'checkin', 'ingreso', 'e'].includes(s)) return 'entrada';
  if (['salida', 'out', 'checkout', 's'].includes(s)) return 'salida';
  return undefined;
}

/** Asistencia del personal: grilla del mes, detalle de marcaciones, marcación manual e importación del reloj. */
export default function RrhhAsistencia() {
  const { usuario } = useAuth();
  const esRrhh = tiene(usuario, 'admin', 'rrhh');
  const areas = useCatalogos().catalogos?.areas ?? [];
  const params = useSearchParams();
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [area, setArea] = useState('');
  const colaboradorId = params.get('colaborador_id') ?? '';
  const [datos, setDatos] = useState(null);
  const [detalle, setDetalle] = useState(null); // { dia, marcaciones }
  const [manual, setManual] = useState({ tipo: 'entrada', hora: '', nota: '' });
  const [importacion, setImportacion] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const cargar = () => {
    setCargando(true);
    setError('');
    rrhhApi.asistencia({ mes, area: area || undefined, colaborador_id: colaboradorId || undefined })
      .then(setDatos).catch((e) => setError(mensajeError(e))).finally(() => setCargando(false));
  };
  useEffect(cargar, [mes, area, colaboradorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // filas: colaborador → { fecha: día }
  const { fechas, filas } = useMemo(() => {
    if (!datos) return { fechas: [], filas: [] };
    const fs = [];
    for (let d = new Date(`${datos.desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= datos.hasta; d.setUTCDate(d.getUTCDate() + 1)) {
      fs.push(d.toISOString().slice(0, 10));
    }
    const porCol = new Map();
    for (const d of datos.dias) {
      if (!porCol.has(d.colaborador_id)) porCol.set(d.colaborador_id, { id: d.colaborador_id, nombre: d.colaborador, area: d.area, dias: {} });
      porCol.get(d.colaborador_id).dias[d.fecha] = d;
    }
    const resumen = new Map(datos.resumen.map((r) => [r.colaborador_id, r]));
    return { fechas: fs, filas: [...porCol.values()].map((f) => ({ ...f, resumen: resumen.get(f.id) })) };
  }, [datos]);

  async function abrir(d) {
    setManual({ tipo: d.entrada ? 'salida' : 'entrada', hora: '', nota: '' });
    try {
      setDetalle({ dia: d, marcaciones: await rrhhApi.marcaciones(d.colaborador_id, d.fecha) });
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function agregarManual(e) {
    e.preventDefault();
    try {
      await rrhhApi.marcacionManual({ colaborador_id: detalle.dia.colaborador_id, fecha: detalle.dia.fecha, ...manual });
      setDetalle({ ...detalle, marcaciones: await rrhhApi.marcaciones(detalle.dia.colaborador_id, detalle.dia.fecha) });
      setManual({ tipo: 'salida', hora: '', nota: '' });
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  async function borrar(m) {
    if (!confirm('¿Eliminar esta marcación?')) return;
    try {
      await rrhhApi.eliminarMarcacion(m.id);
      setDetalle({ ...detalle, marcaciones: detalle.marcaciones.filter((x) => x.id !== m.id) });
      cargar();
    } catch (err) {
      alert(mensajeError(err));
    }
  }

  function leerReloj(e) {
    const archivo = e.target.files[0];
    if (!archivo) return;
    e.target.value = '';
    setImportacion(null);
    Papa.parse(archivo, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: async ({ data, meta }) => {
        const mapa = Object.fromEntries(Object.entries(COLUMNAS_RELOJ).map(([c, alias]) => [c, meta.fields.find((h) => alias.includes(normalizar(h)))]));
        if (!mapa.documento || !(mapa.fecha_hora || (mapa.fecha && mapa.hora))) {
          setImportacion({ error: `El archivo debe tener columnas "documento" (o DNI) y "fecha" + "hora" (o "fecha_hora"). Encontradas: ${meta.fields.join(', ')}` });
          return;
        }
        const filas = data.map((f) => {
          const fh = mapa.fecha_hora ? String(f[mapa.fecha_hora] ?? '').trim() : null;
          return {
            documento: String(f[mapa.documento] ?? '').trim(),
            fecha: leerFecha(fh ?? f[mapa.fecha]),
            hora: leerHora(fh ? fh.slice(fh.search(/\d{1,2}:\d{2}/)) : f[mapa.hora]),
            tipo: mapa.tipo ? leerTipo(f[mapa.tipo]) : undefined,
          };
        });
        try {
          setImportacion(await rrhhApi.importarMarcaciones(filas));
          cargar();
        } catch (err) {
          const det = err.response?.data?.details;
          setImportacion({ error: mensajeError(err) + (det ? `\n${det.join('\n')}` : '') });
        }
      },
      error: (err) => setImportacion({ error: err.message }),
    });
  }

  const dia = detalle?.dia;
  return (
    <>
      <div className="encabezado">
        <h2>Asistencia</h2>
        <div className="fila">
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          {!colaboradorId && (
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Todas las áreas</option>
              {areas.map((a) => <option key={a}>{a}</option>)}
            </select>
          )}
          {colaboradorId && <Link href="/rrhh/asistencia">Ver a todo el personal</Link>}
          {esRrhh && (
            <label className="btn btn-sec adjuntar">⬆ Importar reloj biométrico (CSV)
              <input type="file" hidden accept=".csv,text/csv" onChange={leerReloj} />
            </label>
          )}
        </div>
      </div>

      {importacion && (
        <div className={importacion.error ? 'error-detalle' : 'aviso'}>
          {importacion.error ?? `Marcaciones importadas: ${importacion.insertadas} nuevas, ${importacion.repetidas} ya estaban${importacion.errores.length ? ` · ${importacion.recibidas - importacion.validas} con error:\n${importacion.errores.join('\n')}` : ''}.`}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <section className="tarjeta">
        <div className="leyenda fila">
          {Object.entries(ESTADOS_DIA).filter(([k]) => k !== 'futuro').map(([k, e]) => (
            <span key={k}><span className="dia-celda mini" style={{ background: e.color }}>{e.corto}</span> {e.label}</span>
          ))}
          <span>· número = minutos de tardanza</span>
        </div>
        {cargando && <p>Cargando…</p>}
        <div className="tabla-scroll">
          <table className="grilla-asistencia">
            <thead>
              <tr>
                <th>Colaborador</th>
                {fechas.map((f) => {
                  const dow = (new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7;
                  return <th key={f} className={dow === 6 ? 'domingo' : ''}>{DIAS_SEMANA[dow][0]}<br />{f.slice(8)}</th>;
                })}
                <th className="num">Faltas</th><th className="num">Tard. (min)</th><th className="num">H. extra</th><th className="num">Ausencias</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="sin-envolver"><Link href={`/rrhh/colaboradores/${f.id}`}>{f.nombre}</Link><br /><small>{f.area}</small></td>
                  {fechas.map((fecha) => {
                    const d = f.dias[fecha];
                    if (!d) return <td key={fecha} />;
                    const e = ESTADOS_DIA[d.estado];
                    return (
                      <td key={fecha}>
                        {d.estado !== 'futuro' && (
                          <button className={`dia-celda ${detalle?.dia === d ? 'elegida' : ''}`} style={{ background: e.color }} onClick={() => abrir(d)}
                            title={`${e.label}${d.entrada ? ` · ${hora(d.entrada)}–${d.salida ? hora(d.salida) : '?'}` : ''}${d.feriado ? ` · ${d.feriado}` : ''}`}>
                            {d.minutos_tardanza ? d.minutos_tardanza : e.corto}{d.sin_salida ? '*' : ''}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className={`num ${f.resumen?.faltas ? 'error' : ''}`}>{f.resumen?.faltas}</td>
                  <td className="num">{f.resumen?.minutos_tardanza}</td>
                  <td className="num">{f.resumen?.horas_extra}</td>
                  <td className="num">{(f.resumen?.vacaciones ?? 0) + (f.resumen?.descanso_medico ?? 0) + (f.resumen?.permisos_con_goce ?? 0) + (f.resumen?.permisos_sin_goce ?? 0) + (f.resumen?.licencias_con_goce ?? 0) + (f.resumen?.licencias_sin_goce ?? 0)}</td>
                </tr>
              ))}
              {datos && !filas.length && <tr><td colSpan={fechas.length + 5}>No hay colaboradores en este periodo.</td></tr>}
            </tbody>
          </table>
        </div>
        <small>* sin marcación de salida. Clic en un día para ver el detalle{esRrhh ? ' y corregir marcaciones' : ''}.</small>
      </section>

      {dia && (
        <section className="tarjeta">
          <div className="fila espacio">
            <h3>{dia.colaborador} · {DIAS_SEMANA[(new Date(`${dia.fecha}T12:00:00Z`).getUTCDay() + 6) % 7]} {fechaCorta(dia.fecha)}</h3>
            <button className="btn-sec" onClick={() => setDetalle(null)}>Cerrar</button>
          </div>
          <p>
            <Chip estado={dia.estado} /> {dia.horario ? `Horario ${dia.horario}` : 'Sin horario'}{dia.feriado && ` · ${dia.feriado}`}
            {dia.entrada && <> · Entrada <strong>{hora(dia.entrada)}</strong></>}
            {dia.salida && <> · Salida <strong>{hora(dia.salida)}</strong></>}
            {dia.minutos_trabajados != null && <> · Trabajó {minutos(dia.minutos_trabajados)}</>}
            {dia.minutos_tardanza > 0 && <> · <span className="error">Tardanza {dia.minutos_tardanza} min</span></>}
            {dia.minutos_extra > 0 && <> · Extra {minutos(dia.minutos_extra)}</>}
          </p>
          {dia.origen.includes('gps') && <p><small>🛰️ Incluye el GPS del app de reparto (primera y última posición del día).</small></p>}
          <table>
            <thead><tr><th>Hora</th><th>Tipo</th><th>Origen</th><th>Ubicación</th><th>Nota</th><th /></tr></thead>
            <tbody>
              {detalle.marcaciones.map((m) => (
                <tr key={m.id}>
                  <td>{hora(m.marcado_en)}</td><td>{m.tipo}</td><td>{m.origen}</td>
                  <td>{m.lat != null
                    ? <a href={`https://www.google.com/maps?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer">Ver mapa{m.distancia_m != null ? ` (${(m.distancia_m / 1000).toFixed(1)} km del almacén)` : ''}</a>
                    : '—'}</td>
                  <td>{m.nota}</td>
                  <td className="acciones">{esRrhh && <button className="btn-peligro btn-mini" onClick={() => borrar(m)}>Eliminar</button>}</td>
                </tr>
              ))}
              {!detalle.marcaciones.length && <tr><td colSpan={6}>Sin marcaciones{dia.origen.includes('gps') ? ' (solo GPS del app)' : ''}.</td></tr>}
            </tbody>
          </table>
          {esRrhh && dia.fecha <= hoyISO() && (
            <form className="fila filtros nueva-ruta" onSubmit={agregarManual}>
              <strong>Marcación manual</strong>
              <select value={manual.tipo} onChange={(e) => setManual({ ...manual, tipo: e.target.value })}>
                <option value="entrada">Entrada</option><option value="salida">Salida</option>
              </select>
              <input type="time" required value={manual.hora} onChange={(e) => setManual({ ...manual, hora: e.target.value })} />
              <input className="crece" required maxLength={255} placeholder="Motivo (olvidó marcar, falla del reloj…)" value={manual.nota} onChange={(e) => setManual({ ...manual, nota: e.target.value })} />
              <button>Agregar</button>
            </form>
          )}
        </section>
      )}

      {esRrhh && (
        <details className="tarjeta">
          <summary>Formato del archivo del reloj biométrico</summary>
          <p>CSV con una fila por marcación y estas columnas (el orden no importa):</p>
          <ul className="ayuda-import">
            <li><strong>documento</strong> (o DNI): número de documento de la ficha.</li>
            <li><strong>fecha</strong> (2026-10-09 o 09/10/2026) y <strong>hora</strong> (08:05), o una sola columna <strong>fecha_hora</strong>.</li>
            <li><strong>tipo</strong> (opcional): entrada / salida. Si no viene, la primera marcación del día es la entrada y la última la salida.</li>
          </ul>
          <p><small>Las marcaciones repetidas se ignoran, así que se puede volver a subir el mismo archivo.</small></p>
        </details>
      )}
    </>
  );
}
