import { AREAS, ESTADOS_SOLICITUD, RMV, TIPOS_SOLICITUD } from '../config/catalogos.js';
import { query } from '../config/db.js';
import { RrhhModel } from '../models/rrhh.model.js';
import { asistenciaDiaria, resumirAsistencia } from '../services/asistencia.service.js';
import { HttpError } from '../utils/http.js';
import { CTE_GPS } from './reportes-gps.js';

// Reportes del módulo Recursos Humanos (mismo formato que reporte.controller.js)
const col = (clave, titulo, tipo = 'texto') => ({ clave, titulo, tipo });

const ESTADOS_DIA = {
  asistio: 'Asistió', falta: 'Falta', sin_marcar: 'Sin marcar', feriado: 'Feriado', descanso: 'Descanso', futuro: '—',
  vacaciones: 'Vacaciones', permiso: 'Permiso', descanso_medico: 'Descanso médico', licencia: 'Licencia',
};
const TIPOS = { vacaciones: 'Vacaciones', permiso: 'Permiso', descanso_medico: 'Descanso médico', licencia: 'Licencia' };
const PLAZOS = { '30 días': 30, '60 días': 60, '90 días': 90, 'Solo vencidos': 0 };
const horaLima = (d) => (d ? new Date(d).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }) : '');
const sumar = (filas, k) => filas.reduce((s, r) => s + Number(r[k] ?? 0), 0);

/** La asistencia se calcula día por día: se limita el rango. */
function limitarRango(f, max = 93) {
  if ((new Date(f.hasta) - new Date(f.desde)) / 86400000 >= max) throw new HttpError(400, `Elige un rango de hasta ${max} días`);
}

export const REPORTES_RRHH = {
  personal: {
    titulo: 'Padrón de personal',
    descripcion: 'Fichas con datos laborales, sueldo, sistema de pensiones y cuenta de sueldo.',
    sinFechas: true,
    filtros: [
      { clave: 'area', etiqueta: 'Área', opciones: AREAS },
      { clave: 'estado', etiqueta: 'Estado', opciones: ['Activos', 'Cesados'] },
    ],
    async ejecutar(f) {
      const estado = f.estado === 'Cesados' ? 'cesados' : f.estado === 'Activos' ? 'activos' : 'todos';
      const rows = await RrhhModel.listar({ area: f.area, estado });
      return {
        columnas: [
          col('documento', 'Documento'), col('nombre_completo', 'Colaborador'), col('cargo', 'Cargo'), col('area', 'Área'),
          col('jefe_nombre', 'Jefe'), col('fecha_ingreso', 'Ingreso', 'fecha'), col('tipo_contrato', 'Contrato'),
          col('contrato_fin', 'Fin de contrato', 'fecha'), col('sueldo', 'Sueldo', 'monto'), col('asig_familiar', 'Asig. familiar', 'monto'),
          col('pension', 'Pensión'), col('cuspp', 'CUSPP'), col('banco', 'Banco'), col('cuenta_sueldo', 'Cuenta sueldo'),
          col('cci', 'CCI'), col('telefono', 'Teléfono'), col('horario_nombre', 'Horario'), col('usuario_email', 'Usuario del sistema'),
          col('licencia', 'Licencia'), col('licencia_vence', 'Vence licencia', 'fecha'), col('estado_txt', 'Estado'),
          col('fecha_cese', 'Cese', 'fecha'), col('motivo_cese', 'Motivo de cese'),
        ],
        filas: rows.map((r) => ({
          ...r,
          documento: `${r.tipo_documento} ${r.numero_documento}`,
          asig_familiar: r.asignacion_familiar ? RMV * 0.1 : 0,
          pension: r.sistema_pension === 'AFP' ? `AFP ${r.afp ?? ''}` : r.sistema_pension,
          licencia: r.licencia_categoria ? `${r.licencia_categoria} ${r.licencia_numero ?? ''}` : '',
          estado_txt: r.activo ? 'Activo' : 'Cesado',
        })),
        resumen: [
          { etiqueta: 'Colaboradores', valor: rows.length },
          { etiqueta: 'Activos', valor: rows.filter((r) => r.activo).length },
          { etiqueta: 'Sueldos (activos)', valor: sumar(rows.filter((r) => r.activo), 'sueldo'), tipo: 'monto' },
          { etiqueta: 'Sin usuario del sistema', valor: rows.filter((r) => r.activo && !r.usuario_id).length },
        ],
      };
    },
  },

  vencimientos: {
    titulo: 'Vencimientos',
    descripcion: 'Contratos, licencias de conducir, SCTR, exámenes médicos y documentos vencidos o por vencer.',
    sinFechas: true,
    filtros: [{ clave: 'plazo', etiqueta: 'Plazo', opciones: Object.keys(PLAZOS) }],
    async ejecutar(f) {
      const plazo = PLAZOS[f.plazo] ?? 60;
      const rows = (await RrhhModel.vencimientos(Math.max(plazo, 1))).filter((r) => plazo > 0 || r.dias_restantes < 0);
      return {
        columnas: [
          col('colaborador', 'Colaborador'), col('area', 'Área'), col('cargo', 'Cargo'), col('concepto', 'Concepto'),
          col('vence', 'Vence', 'fecha'), col('dias_restantes', 'Días restantes', 'entero'), col('situacion', 'Situación'),
        ],
        filas: rows.map((r) => ({ ...r, situacion: r.dias_restantes < 0 ? 'Vencido' : r.dias_restantes <= 15 ? 'Urgente' : 'Por vencer' })),
        resumen: [
          { etiqueta: 'Vencidos', valor: rows.filter((r) => r.dias_restantes < 0).length, alerta: rows.some((r) => r.dias_restantes < 0) },
          { etiqueta: 'Vencen en 15 días', valor: rows.filter((r) => r.dias_restantes >= 0 && r.dias_restantes <= 15).length },
          { etiqueta: 'Total', valor: rows.length },
        ],
      };
    },
  },

  asistencia: {
    titulo: 'Asistencia diaria',
    descripcion: 'Entrada, salida, tardanza y horas extra de cada día. Conductores y auxiliares toman el GPS del app.',
    filtros: [
      { clave: 'area', etiqueta: 'Área', opciones: AREAS },
      { clave: 'estado', etiqueta: 'Estado', opciones: Object.values(ESTADOS_DIA).filter((e) => e !== '—') },
    ],
    async ejecutar(f) {
      limitarRango(f);
      const dias = (await asistenciaDiaria({ desde: f.desde, hasta: f.hasta, area: f.area }))
        .filter((d) => d.estado !== 'futuro')
        .map((d) => ({
          ...d, estado_txt: ESTADOS_DIA[d.estado], entrada_txt: horaLima(d.entrada), salida_txt: horaLima(d.salida),
          trabajado: d.minutos_trabajados != null ? d.minutos_trabajados * 60 : null, extra: d.minutos_extra * 60,
          observacion: [d.feriado, d.sin_salida ? 'Sin salida' : null, d.con_goce === false ? 'Sin goce' : null].filter(Boolean).join(' · '),
        }))
        .filter((d) => !f.estado || d.estado_txt === f.estado);
      return {
        columnas: [
          col('fecha', 'Fecha', 'fecha'), col('colaborador', 'Colaborador'), col('area', 'Área'), col('horario', 'Horario'),
          col('estado_txt', 'Estado'), col('entrada_txt', 'Entrada'), col('salida_txt', 'Salida'),
          col('minutos_tardanza', 'Tardanza (min)', 'entero'), col('trabajado', 'Trabajado', 'duracion'),
          col('extra', 'Horas extra', 'duracion'), col('origen', 'Origen'), col('observacion', 'Observación'),
        ],
        filas: dias,
        resumen: [
          { etiqueta: 'Asistencias', valor: dias.filter((d) => d.estado === 'asistio').length },
          { etiqueta: 'Faltas', valor: dias.filter((d) => d.estado === 'falta').length, alerta: dias.some((d) => d.estado === 'falta') },
          { etiqueta: 'Tardanzas', valor: dias.filter((d) => d.minutos_tardanza > 0).length },
          { etiqueta: 'Sin salida', valor: dias.filter((d) => d.sin_salida).length },
        ],
      };
    },
  },

  asistencia_resumen: {
    titulo: 'Resumen de asistencia',
    descripcion: 'Totales del periodo por colaborador: faltas, tardanzas, horas extra y ausencias.',
    filtros: [{ clave: 'area', etiqueta: 'Área', opciones: AREAS }],
    async ejecutar(f) {
      limitarRango(f);
      const rows = resumirAsistencia(await asistenciaDiaria({ desde: f.desde, hasta: f.hasta, area: f.area }));
      return {
        columnas: [
          col('colaborador', 'Colaborador'), col('area', 'Área'), col('dias_laborables', 'Días laborables', 'entero'),
          col('asistencias', 'Asistencias', 'entero'), col('faltas', 'Faltas', 'entero'), col('tardanzas', 'Tardanzas', 'entero'),
          col('minutos_tardanza', 'Min. tardanza', 'entero'), col('horas_trabajadas', 'Horas trabajadas', 'entero'),
          col('horas_extra', 'Horas extra', 'entero'), col('feriados_trabajados', 'Descansos/feriados trabajados', 'entero'),
          col('vacaciones', 'Vacaciones', 'entero'), col('descanso_medico', 'Descanso médico', 'entero'),
          col('permisos_con_goce', 'Permisos con goce', 'entero'), col('permisos_sin_goce', 'Permisos sin goce', 'entero'),
          col('licencias_sin_goce', 'Licencias sin goce', 'entero'), col('sin_salida', 'Días sin salida', 'entero'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Colaboradores', valor: rows.length },
          { etiqueta: 'Faltas', valor: sumar(rows, 'faltas'), alerta: sumar(rows, 'faltas') > 0 },
          { etiqueta: 'Minutos de tardanza', valor: sumar(rows, 'minutos_tardanza') },
          { etiqueta: 'Horas extra', valor: Math.round(sumar(rows, 'horas_extra') * 10) / 10 },
        ],
      };
    },
  },

  solicitudes: {
    titulo: 'Vacaciones y permisos',
    descripcion: 'Solicitudes del periodo (vacaciones, permisos, descansos médicos y licencias) y quién las atendió.',
    filtros: [
      { clave: 'tipo', etiqueta: 'Tipo', opciones: TIPOS_SOLICITUD },
      { clave: 'estado', etiqueta: 'Estado', opciones: ESTADOS_SOLICITUD },
    ],
    async ejecutar(f) {
      const rows = await RrhhModel.solicitudes({ desde: f.desde, hasta: f.hasta, tipo: f.tipo, estado: f.estado });
      return {
        columnas: [
          col('colaborador', 'Colaborador'), col('area', 'Área'), col('tipo_txt', 'Tipo'), col('goce', 'Goce'),
          col('desde', 'Desde', 'fecha'), col('hasta', 'Hasta', 'fecha'), col('dias', 'Días', 'entero'), col('motivo', 'Motivo'),
          col('estado', 'Estado'), col('resuelto_por_nombre', 'Atendió'), col('resuelto_en', 'Atendida', 'fechahora'),
          col('respuesta', 'Respuesta'), col('creado_en', 'Solicitada', 'fechahora'),
        ],
        filas: rows.map((r) => ({ ...r, tipo_txt: TIPOS[r.tipo], goce: r.con_goce ? 'Con goce' : 'Sin goce' })),
        resumen: [
          { etiqueta: 'Solicitudes', valor: rows.length },
          { etiqueta: 'Pendientes', valor: rows.filter((r) => r.estado === 'pendiente').length, alerta: rows.some((r) => r.estado === 'pendiente') },
          { etiqueta: 'Días aprobados', valor: sumar(rows.filter((r) => r.estado === 'aprobada'), 'dias') },
        ],
      };
    },
  },

  vacaciones: {
    titulo: 'Saldo de vacaciones',
    descripcion: 'Días devengados (30 por año, 2,5 por mes), gozados, programados y saldo de cada colaborador activo.',
    sinFechas: true,
    filtros: [{ clave: 'area', etiqueta: 'Área', opciones: AREAS }],
    async ejecutar(f) {
      const cols = await RrhhModel.listar({ area: f.area });
      const saldos = cols.length ? await RrhhModel.vacaciones(cols.map((c) => c.id)) : {};
      const rows = cols.map((c) => ({ ...c, ...saldos[c.id] }));
      return {
        columnas: [
          col('nombre_completo', 'Colaborador'), col('area', 'Área'), col('fecha_ingreso', 'Ingreso', 'fecha'),
          col('anios_completos', 'Años completos', 'entero'), col('devengados', 'Devengados', 'entero'), col('ajuste', 'Ajuste', 'entero'),
          col('gozados', 'Gozados', 'entero'), col('programados', 'Programados', 'entero'), col('pendientes', 'Por aprobar', 'entero'),
          col('saldo', 'Saldo', 'entero'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Colaboradores', valor: rows.length },
          { etiqueta: 'Días de saldo total', valor: Math.round(sumar(rows, 'saldo')) },
          { etiqueta: 'Con más de 30 días acumulados', valor: rows.filter((r) => r.saldo > 30).length, alerta: rows.some((r) => r.saldo > 30) },
        ],
      };
    },
  },

  desempeno: {
    titulo: 'Desempeño de reparto',
    descripcion: 'Por conductor y auxiliar: rutas, entregas, incidencias, efectividad y km recorridos según el GPS.',
    async ejecutar(f) {
      const { rows } = await query(
        `WITH ${CTE_GPS},
         eq AS (
           SELECT r.id AS ruta_id, r.fecha, r.repartidor_id AS usuario_id, 'conductor' AS rol FROM rutas r
           WHERE r.fecha BETWEEN $1 AND $2 AND r.repartidor_id IS NOT NULL
           UNION ALL
           SELECT r.id, r.fecha, r.asistente_id, 'auxiliar' FROM rutas r WHERE r.fecha BETWEEN $1 AND $2 AND r.asistente_id IS NOT NULL
         ),
         par AS (
           SELECT x.ruta_id,
                  COUNT(*) FILTER (WHERE x.pedido_id IS NOT NULL AND x.estado = 'completada') AS entregas,
                  COUNT(*) FILTER (WHERE x.estado = 'incidencia') AS incidencias,
                  COUNT(*) FILTER (WHERE x.estado = 'cancelada') AS canceladas,
                  COUNT(*) FILTER (WHERE x.estado = 'completada') AS paradas
           FROM ruta_paradas x JOIN rutas r ON r.id = x.ruta_id WHERE r.fecha BETWEEN $1 AND $2 GROUP BY 1
         )
         SELECT u.id, u.nombre, c.nombres || ' ' || c.apellidos AS colaborador, c.area,
                COUNT(DISTINCT eq.fecha)::int AS dias,
                COUNT(*) FILTER (WHERE eq.rol = 'conductor')::int AS rutas_conductor,
                COUNT(*) FILTER (WHERE eq.rol = 'auxiliar')::int AS rutas_auxiliar,
                COALESCE(SUM(par.paradas), 0)::int AS paradas, COALESCE(SUM(par.entregas), 0)::int AS entregas,
                COALESCE(SUM(par.incidencias), 0)::int AS incidencias, COALESCE(SUM(par.canceladas), 0)::int AS canceladas,
                ROUND(COALESCE(SUM(gps.km) FILTER (WHERE eq.rol = 'conductor'), 0)::numeric, 1) AS km
         FROM eq JOIN usuarios u ON u.id = eq.usuario_id
         LEFT JOIN par ON par.ruta_id = eq.ruta_id
         LEFT JOIN gps ON gps.ruta_id = eq.ruta_id
         LEFT JOIN colaboradores c ON c.usuario_id = u.id
         GROUP BY u.id, u.nombre, c.nombres, c.apellidos, c.area
         ORDER BY entregas DESC`,
        [f.desde, f.hasta]
      );
      const filas = rows.map((r) => ({
        ...r,
        colaborador: r.colaborador ?? `${r.nombre} (sin ficha)`,
        efectividad: r.entregas + r.incidencias ? (r.entregas / (r.entregas + r.incidencias)) * 100 : null,
        entregas_dia: r.dias ? Math.round((r.entregas / r.dias) * 10) / 10 : 0,
      }));
      return {
        columnas: [
          col('colaborador', 'Colaborador'), col('dias', 'Días con ruta', 'entero'), col('rutas_conductor', 'Rutas (conductor)', 'entero'),
          col('rutas_auxiliar', 'Rutas (auxiliar)', 'entero'), col('paradas', 'Paradas atendidas', 'entero'),
          col('entregas', 'Entregas', 'entero'), col('entregas_dia', 'Entregas por día', 'entero'), col('incidencias', 'Incidencias', 'entero'),
          col('canceladas', 'Canceladas en ruta', 'entero'), col('efectividad', 'Efectividad', 'pct'), col('km', 'Km (GPS)', 'km'),
        ],
        filas,
        resumen: [
          { etiqueta: 'Personas', valor: filas.length },
          { etiqueta: 'Entregas', valor: sumar(filas, 'entregas') },
          { etiqueta: 'Incidencias', valor: sumar(filas, 'incidencias') },
          { etiqueta: 'Km (conductores)', valor: sumar(filas, 'km'), tipo: 'km' },
        ],
      };
    },
  },

  planilla: {
    titulo: 'Datos para planilla',
    descripcion: 'Exportación mensual para el contador: remuneración, pensiones, cuenta y días no remunerados, tardanzas y horas extra.',
    filtros: [{ clave: 'area', etiqueta: 'Área', opciones: AREAS }],
    async ejecutar(f) {
      limitarRango(f, 62);
      const [cols, dias] = await Promise.all([
        RrhhModel.listar({ area: f.area, estado: 'todos' }),
        asistenciaDiaria({ desde: f.desde, hasta: f.hasta, area: f.area }),
      ]);
      const resumen = new Map(resumirAsistencia(dias).map((r) => [r.colaborador_id, r]));
      const filas = cols.filter((c) => resumen.has(c.id)).map((c) => {
        const a = resumen.get(c.id);
        return {
          ...c, ...a,
          documento: `${c.tipo_documento} ${c.numero_documento}`,
          asig_familiar: c.asignacion_familiar ? RMV * 0.1 : 0,
          pension: c.sistema_pension === 'AFP' ? `AFP ${c.afp ?? ''}` : c.sistema_pension,
          no_remunerados: a.faltas + a.permisos_sin_goce + a.licencias_sin_goce,
        };
      });
      return {
        columnas: [
          col('documento', 'Documento'), col('nombre_completo', 'Colaborador'), col('cargo', 'Cargo'), col('area', 'Área'),
          col('fecha_ingreso', 'Ingreso', 'fecha'), col('fecha_cese', 'Cese', 'fecha'), col('tipo_contrato', 'Contrato'),
          col('sueldo', 'Sueldo', 'monto'), col('asig_familiar', 'Asig. familiar', 'monto'), col('pension', 'Pensión'),
          col('cuspp', 'CUSPP'), col('essalud_txt', 'EsSalud'), col('banco', 'Banco'), col('cuenta_sueldo', 'Cuenta'),
          col('dias_laborables', 'Días laborables', 'entero'), col('asistencias', 'Asistencias', 'entero'),
          col('faltas', 'Faltas', 'entero'), col('permisos_sin_goce', 'Permisos sin goce', 'entero'),
          col('licencias_sin_goce', 'Licencias sin goce', 'entero'), col('no_remunerados', 'Días no remunerados', 'entero'),
          col('minutos_tardanza', 'Min. tardanza', 'entero'), col('horas_extra', 'Horas extra', 'entero'),
          col('feriados_trabajados', 'Descansos/feriados trabajados', 'entero'), col('vacaciones', 'Días de vacaciones', 'entero'),
          col('descanso_medico', 'Días de descanso médico', 'entero'), col('licencias_con_goce', 'Licencias con goce', 'entero'),
        ],
        filas: filas.map((r) => ({ ...r, essalud_txt: r.essalud ? 'Sí' : 'No' })),
        resumen: [
          { etiqueta: 'Colaboradores', valor: filas.length },
          { etiqueta: 'Sueldos + asig. familiar', valor: sumar(filas, 'sueldo') + sumar(filas, 'asig_familiar'), tipo: 'monto' },
          { etiqueta: 'Días no remunerados', valor: sumar(filas, 'no_remunerados') },
          { etiqueta: 'Horas extra', valor: Math.round(sumar(filas, 'horas_extra') * 10) / 10 },
        ],
      };
    },
  },
};
