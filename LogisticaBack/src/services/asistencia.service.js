import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { hoy } from '../utils/fecha.js';

/*
 * Asistencia diaria de cada colaborador. Combina:
 *  - marcaciones (web, celular, reloj biométrico, manual de RRHH)
 *  - el GPS del app de reparto: la primera y la última posición del día de conductores y auxiliares
 *    cuentan como inicio y fin de turno, sin que tengan que marcar aparte
 *  - su horario (días laborables, hora de entrada con tolerancia, refrigerio)
 *  - feriados y ausencias aprobadas (vacaciones, permisos, descansos médicos, licencias)
 */

const TZ = env.timezone;
const DIAS_LABORABLES_POR_DEFECTO = [1, 2, 3, 4, 5, 6];

const horaLocal = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Minutos desde la medianoche (hora de Lima). */
const minutosDelDia = (fecha) => {
  const [h, m] = horaLocal.format(fecha).split(':').map(Number);
  return h * 60 + m;
};
const minutosDeHora = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);
const minutosEntre = (a, b) => Math.round((b - a) / 60000);

export const AUSENCIAS = ['vacaciones', 'permiso', 'descanso_medico', 'licencia'];

/** Estado de un día: asistio, falta, sin_marcar (hoy), feriado, descanso, vacaciones, permiso, descanso_medico, licencia. */
function calcularDia(r, fechaHoy) {
  const dias = r.dias_lab ?? DIAS_LABORABLES_POR_DEFECTO;
  const laborable = dias.includes(r.dow) && !r.feriado;

  const entrada = [r.m_primera, r.g_primera].filter(Boolean).sort((a, b) => a - b)[0] ?? null;
  // la última marcación es salida si hay más de una (o si se marcó como salida); con el GPS, la última posición
  const candidatasSalida = [
    r.m_ultima && (r.marcas > 1 || r.hay_salida) ? r.m_ultima : null,
    r.g_ultima && r.g_ultima > r.g_primera ? r.g_ultima : null,
  ].filter(Boolean);
  let salida = candidatasSalida.sort((a, b) => b - a)[0] ?? null;
  if (salida && entrada && salida <= entrada) salida = null;

  const jornada = r.hora_entrada
    ? minutosDeHora(r.hora_salida) - minutosDeHora(r.hora_entrada) - r.refrigerio_min
    : null;
  const trabajados = entrada && salida
    ? Math.max(0, minutosEntre(entrada, salida) - (minutosEntre(entrada, salida) > 6 * 60 ? (r.refrigerio_min ?? 60) : 0))
    : null;

  let estado;
  if (r.ausencia) estado = r.ausencia;
  else if (entrada) estado = 'asistio';
  else if (r.fecha > fechaHoy) estado = 'futuro';
  else if (!laborable) estado = r.feriado ? 'feriado' : 'descanso';
  else if (r.fecha === fechaHoy) estado = 'sin_marcar';
  else estado = 'falta';

  // tardanza: pasada la tolerancia se cuentan todos los minutos desde la hora de entrada
  let tardanza = 0;
  if (estado === 'asistio' && laborable && r.hora_entrada) {
    const tarde = minutosDelDia(entrada) - minutosDeHora(r.hora_entrada);
    if (tarde > r.tolerancia_min) tardanza = tarde;
  }
  let extra = 0;
  if (estado === 'asistio' && trabajados != null) {
    if (!laborable) extra = trabajados; // trabajó en su día de descanso o en feriado
    else if (jornada != null) extra = Math.max(0, trabajados - jornada);
  }

  return {
    colaborador_id: r.id,
    colaborador: r.colaborador,
    area: r.area,
    cargo: r.cargo,
    horario: r.horario,
    fecha: r.fecha,
    feriado: r.feriado,
    laborable,
    estado,
    con_goce: r.ausencia ? r.con_goce : null,
    entrada,
    salida,
    origen: [r.origenes, r.g_primera ? 'gps' : null].filter(Boolean).join(','),
    minutos_trabajados: trabajados,
    minutos_tardanza: tardanza,
    minutos_extra: extra,
    sin_salida: estado === 'asistio' && !salida && r.fecha < fechaHoy,
  };
}

/**
 * Días de asistencia de los colaboradores indicados entre dos fechas (inclusive).
 * `colaboradorIds` null = todo el personal.
 */
export async function asistenciaDiaria({ desde, hasta, colaboradorIds = null, area = null }) {
  const { rows } = await query(
    `WITH dias AS (SELECT d::date AS fecha FROM generate_series($1::date, $2::date, interval '1 day') d),
     col AS (
       SELECT c.id, c.nombres || ' ' || c.apellidos AS colaborador, c.area, c.cargo, c.usuario_id, c.fecha_ingreso, c.fecha_cese,
              h.nombre AS horario, to_char(h.hora_entrada, 'HH24:MI') AS hora_entrada, to_char(h.hora_salida, 'HH24:MI') AS hora_salida,
              h.tolerancia_min, h.refrigerio_min, h.dias::int[] AS dias_lab
       FROM colaboradores c LEFT JOIN rrhh_horarios h ON h.id = c.horario_id
       WHERE ($3::int[] IS NULL OR c.id = ANY($3)) AND ($4::text IS NULL OR c.area = $4)
         AND c.fecha_ingreso <= $2 AND (c.fecha_cese IS NULL OR c.fecha_cese >= $1)
     ),
     marc AS (
       SELECT m.colaborador_id, (m.marcado_en AT TIME ZONE '${TZ}')::date AS fecha, MIN(m.marcado_en) AS primera,
              MAX(m.marcado_en) AS ultima, COUNT(*)::int AS marcas, bool_or(m.tipo = 'salida') AS hay_salida,
              string_agg(DISTINCT m.origen, ',') AS origenes
       FROM rrhh_marcaciones m JOIN col ON col.id = m.colaborador_id
       WHERE m.marcado_en >= $1::date::timestamp AT TIME ZONE '${TZ}' AND m.marcado_en < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
       GROUP BY 1, 2
     ),
     gps AS (
       SELECT col.id AS colaborador_id, (p.registrado_en AT TIME ZONE '${TZ}')::date AS fecha,
              MIN(p.registrado_en) AS primera, MAX(p.registrado_en) AS ultima
       FROM posiciones p JOIN col ON col.usuario_id = p.usuario_id
       WHERE p.registrado_en >= $1::date::timestamp AT TIME ZONE '${TZ}' AND p.registrado_en < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}'
       GROUP BY 1, 2
     ),
     aus AS (
       SELECT DISTINCT ON (s.colaborador_id, d.fecha) s.colaborador_id, d.fecha, s.tipo, s.con_goce
       FROM rrhh_solicitudes s JOIN col ON col.id = s.colaborador_id JOIN dias d ON d.fecha BETWEEN s.desde AND s.hasta
       WHERE s.estado = 'aprobada'
       ORDER BY s.colaborador_id, d.fecha, s.id DESC
     )
     SELECT c.*, d.fecha::text AS fecha, EXTRACT(ISODOW FROM d.fecha)::int AS dow, f.nombre AS feriado,
            m.primera AS m_primera, m.ultima AS m_ultima, m.marcas, m.hay_salida, m.origenes,
            g.primera AS g_primera, g.ultima AS g_ultima, a.tipo AS ausencia, a.con_goce
     FROM col c CROSS JOIN dias d
     LEFT JOIN rrhh_feriados f ON f.fecha = d.fecha
     LEFT JOIN marc m ON m.colaborador_id = c.id AND m.fecha = d.fecha
     LEFT JOIN gps g ON g.colaborador_id = c.id AND g.fecha = d.fecha
     LEFT JOIN aus a ON a.colaborador_id = c.id AND a.fecha = d.fecha
     WHERE d.fecha >= c.fecha_ingreso AND (c.fecha_cese IS NULL OR d.fecha <= c.fecha_cese)
     ORDER BY c.colaborador, d.fecha`,
    [desde, hasta, colaboradorIds, area]
  );
  const fechaHoy = hoy();
  return rows.map((r) => calcularDia(r, fechaHoy));
}

/** Totales por colaborador (reporte mensual y datos para planilla). */
export function resumirAsistencia(dias) {
  const porColaborador = new Map();
  for (const d of dias) {
    if (!porColaborador.has(d.colaborador_id)) {
      porColaborador.set(d.colaborador_id, {
        colaborador_id: d.colaborador_id, colaborador: d.colaborador, area: d.area, cargo: d.cargo, horario: d.horario,
        dias_laborables: 0, asistencias: 0, faltas: 0, tardanzas: 0, minutos_tardanza: 0, minutos_trabajados: 0,
        minutos_extra: 0, sin_salida: 0, vacaciones: 0, descanso_medico: 0, permisos_con_goce: 0,
        permisos_sin_goce: 0, licencias_con_goce: 0, licencias_sin_goce: 0, feriados_trabajados: 0,
      });
    }
    const t = porColaborador.get(d.colaborador_id);
    if (d.laborable && d.estado !== 'futuro') t.dias_laborables++;
    if (d.estado === 'asistio') {
      t.asistencias++;
      if (!d.laborable) t.feriados_trabajados++;
    }
    if (d.estado === 'falta') t.faltas++;
    if (d.minutos_tardanza > 0) { t.tardanzas++; t.minutos_tardanza += d.minutos_tardanza; }
    t.minutos_trabajados += d.minutos_trabajados ?? 0;
    t.minutos_extra += d.minutos_extra;
    if (d.sin_salida) t.sin_salida++;
    if (d.estado === 'vacaciones') t.vacaciones++;
    if (d.estado === 'descanso_medico') t.descanso_medico++;
    if (d.estado === 'permiso') t[d.con_goce ? 'permisos_con_goce' : 'permisos_sin_goce']++;
    if (d.estado === 'licencia') t[d.con_goce ? 'licencias_con_goce' : 'licencias_sin_goce']++;
  }
  return [...porColaborador.values()].map((t) => ({
    ...t,
    horas_trabajadas: Math.round((t.minutos_trabajados / 60) * 10) / 10,
    horas_extra: Math.round((t.minutos_extra / 60) * 10) / 10,
  }));
}
