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

const sino = (b) => (b ? 'Sí' : 'No');

export const REPORTES_RRHH = {
  tregistro: {
    titulo: 'T-Registro',
    descripcion: 'Datos de cada trabajador como los pide el T-Registro de SUNAT (alta, modificación y baja). Revisa los campos vacíos antes de registrar.',
    sinFechas: true,
    filtros: [{ clave: 'estado', etiqueta: 'Estado', opciones: ['Activos', 'Cesados'] }],
    async ejecutar(f) {
      const estado = f.estado === 'Cesados' ? 'cesados' : f.estado === 'Activos' ? 'activos' : 'todos';
      const [rows, { rows: ubigeos }] = await Promise.all([
        RrhhModel.listar({ estado }),
        query('SELECT codigo, departamento, provincia, distrito FROM ubigeos'),
      ]);
      const ub = new Map(ubigeos.map((u) => [u.codigo, u]));
      const OBLIGATORIOS = {
        fecha_nacimiento: 'fecha de nacimiento', sexo: 'sexo', direccion: 'domicilio', ubigeo: 'distrito',
        situacion_educativa: 'situación educativa', ocupacion: 'ocupación',
      };
      const filas = rows.filter((r) => !r.tipo_contrato.startsWith('Locación')).map((r) => {
        const faltan = Object.entries(OBLIGATORIOS).filter(([k]) => !r[k]).map(([, t]) => t);
        if (r.sistema_pension === 'AFP' && !r.cuspp) faltan.push('CUSPP');
        if (r.tipo_pago === 'Depósito en cuenta' && !r.cuenta_sueldo) faltan.push('cuenta de sueldo');
        const u = ub.get(r.ubigeo);
        return {
          ...r,
          documento: r.numero_documento,
          ubigeo_txt: u ? `${r.ubigeo} ${u.departamento} / ${u.provincia} / ${u.distrito}` : '',
          pension: r.sistema_pension === 'AFP' ? `SPP ${r.afp ?? ''} (comisión ${r.comision_afp?.toLowerCase() ?? '?'})` : r.sistema_pension === 'ONP' ? 'SNP (ONP)' : 'Sin régimen',
          sctr_txt: r.sctr ? `Salud: ${r.sctr_salud ?? '?'} · Pensión: ${r.sctr_pension ?? '?'}` : 'No',
          discapacidad_txt: sino(r.discapacidad), sindicalizado_txt: sino(r.sindicalizado), atipica_txt: sino(r.jornada_atipica),
          nocturno_txt: sino(r.horario_nocturno), asig_txt: sino(r.asignacion_familiar),
          estudios: [r.institucion_educativa, r.carrera, r.anio_egreso].filter(Boolean).join(' · '),
          faltan: faltan.join(', '),
        };
      });
      return {
        columnas: [
          col('tipo_documento', 'Tipo doc.'), col('documento', 'Nro. documento'), col('pais_emisor', 'País emisor'),
          col('apellido_paterno', 'Ap. paterno'), col('apellido_materno', 'Ap. materno'), col('nombres', 'Nombres'),
          col('fecha_nacimiento', 'Nacimiento', 'fecha'), col('sexo', 'Sexo'), col('nacionalidad', 'Nacionalidad'),
          col('estado_civil', 'Estado civil'), col('telefono', 'Teléfono'), col('email_personal', 'Correo'),
          col('direccion', 'Domicilio'), col('direccion_referencia', 'Referencia'), col('ubigeo_txt', 'Ubigeo'),
          col('situacion_educativa', 'Situación educativa'), col('estudios', 'Institución · carrera · egreso'),
          col('discapacidad_txt', 'Discapacidad'), col('carne_conadis', 'CONADIS'),
          col('regimen_laboral', 'Régimen laboral'), col('categoria_ocupacional', 'Categoría ocupacional'),
          col('ocupacion', 'Ocupación'), col('cargo', 'Cargo'), col('tipo_contrato', 'Tipo de contrato'),
          col('fecha_ingreso', 'Fecha de inicio', 'fecha'), col('contrato_fin', 'Fin de contrato', 'fecha'),
          col('periodo_prueba_fin', 'Fin periodo de prueba', 'fecha'), col('situacion_especial', 'Situación especial'),
          col('jornada', 'Jornada'), col('atipica_txt', 'Jornada atípica/acumulativa'), col('nocturno_txt', 'Horario nocturno'),
          col('sindicalizado_txt', 'Sindicalizado'), col('sueldo', 'Remuneración básica', 'monto'), col('asig_txt', 'Asig. familiar'),
          col('periodicidad_pago', 'Periodicidad'), col('tipo_pago', 'Tipo de pago'), col('banco', 'Banco'),
          col('cuenta_sueldo', 'Cuenta sueldo'), col('banco_cts', 'Banco CTS'), col('cuenta_cts', 'Cuenta CTS'),
          col('regimen_salud', 'Régimen de salud'), col('eps', 'EPS'), col('pension', 'Régimen pensionario'),
          col('cuspp', 'CUSPP'), col('pension_fecha_inscripcion', 'Inscripción pensión', 'fecha'), col('sctr_txt', 'SCTR'),
          col('fecha_cese', 'Fecha de baja', 'fecha'), col('motivo_cese', 'Motivo de baja'), col('faltan', 'Datos por completar'),
        ],
        filas,
        resumen: [
          { etiqueta: 'Trabajadores', valor: filas.length },
          { etiqueta: 'Con datos por completar', valor: filas.filter((r) => r.faltan).length, alerta: filas.some((r) => r.faltan) },
          { etiqueta: 'Locadores excluidos', valor: rows.length - filas.length },
        ],
      };
    },
  },

  derechohabientes: {
    titulo: 'Derechohabientes',
    descripcion: 'Cónyuges, concubinos e hijos registrados (EsSalud y sustento de la asignación familiar).',
    sinFechas: true,
    async ejecutar() {
      const { rows } = await query(
        `SELECT d.*, concat_ws(' ', d.nombres, d.apellido_paterno, d.apellido_materno) AS derechohabiente,
                concat_ws(' ', c.nombres, c.apellido_paterno, c.apellido_materno) AS colaborador, c.numero_documento AS doc_titular,
                c.asignacion_familiar, EXTRACT(YEAR FROM age(now()::date, d.fecha_nacimiento))::int AS edad
         FROM rrhh_derechohabientes d JOIN colaboradores c ON c.id = d.colaborador_id
         WHERE c.activo ORDER BY colaborador, d.fecha_nacimiento NULLS LAST`
      );
      const filas = rows.map((r) => ({
        ...r,
        documento: r.numero_documento ? `${r.tipo_documento} ${r.numero_documento}` : '',
        situacion: r.activo ? 'Activo' : 'De baja',
        // hijos que sustentan la asignación familiar: menores de 18 o hasta 24 si cursan estudios superiores
        sustenta: r.activo && r.vinculo.startsWith('Hijo') && (r.edad == null || r.edad < 18 || (r.estudia && r.edad < 24)) ? 'Sí' : 'No',
      }));
      const titulares = new Set(filas.filter((r) => r.sustenta === 'Sí').map((r) => r.colaborador_id));
      const sinSustento = (await RrhhModel.listar({})).filter((c) => c.asignacion_familiar && !titulares.has(c.id));
      return {
        columnas: [
          col('colaborador', 'Titular'), col('doc_titular', 'Doc. titular'), col('vinculo', 'Vínculo'), col('derechohabiente', 'Derechohabiente'),
          col('documento', 'Documento'), col('fecha_nacimiento', 'Nacimiento', 'fecha'), col('edad', 'Edad', 'entero'),
          col('documento_vinculo', 'Acredita vínculo'), col('sustenta', 'Sustenta asig. familiar'), col('situacion', 'Situación'),
        ],
        filas,
        resumen: [
          { etiqueta: 'Derechohabientes', valor: filas.length },
          { etiqueta: 'Con asig. familiar sin hijo registrado', valor: sinSustento.length, alerta: sinSustento.length > 0 },
        ],
      };
    },
  },

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
          col('regimen_laboral', 'Régimen laboral'), col('pension', 'Pensión'), col('cuspp', 'CUSPP'), col('regimen_salud', 'Salud'),
          col('banco', 'Banco'), col('cuenta_sueldo', 'Cuenta sueldo'),
          col('cci', 'CCI'), col('telefono', 'Teléfono'), col('horario_nombre', 'Horario'), col('usuario_email', 'Usuario del sistema'),
          col('licencia', 'Licencia'), col('licencia_vence', 'Vence licencia', 'fecha'), col('estado_txt', 'Estado'),
          col('fecha_cese', 'Cese', 'fecha'), col('motivo_cese', 'Motivo de cese'),
        ],
        filas: rows.map((r) => ({
          ...r,
          documento: `${r.tipo_documento} ${r.numero_documento}`,
          asig_familiar: r.asignacion_familiar ? RMV * 0.1 : 0,
          pension: r.sistema_pension === 'AFP' ? `AFP ${r.afp ?? ''} (${r.comision_afp ?? '?'})` : r.sistema_pension,
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
         SELECT u.id, u.nombre, concat_ws(' ', c.nombres, c.apellido_paterno, c.apellido_materno) AS colaborador, c.area,
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
         GROUP BY u.id, u.nombre, c.nombres, c.apellido_paterno, c.apellido_materno, c.area
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
          pension: c.sistema_pension === 'AFP' ? `AFP ${c.afp ?? ''} (${c.comision_afp ?? '?'})` : c.sistema_pension,
          no_remunerados: a.faltas + a.permisos_sin_goce + a.licencias_sin_goce,
        };
      });
      return {
        columnas: [
          col('documento', 'Documento'), col('nombre_completo', 'Colaborador'), col('cargo', 'Cargo'), col('area', 'Área'),
          col('fecha_ingreso', 'Ingreso', 'fecha'), col('fecha_cese', 'Cese', 'fecha'), col('tipo_contrato', 'Contrato'),
          col('sueldo', 'Sueldo', 'monto'), col('asig_familiar', 'Asig. familiar', 'monto'), col('pension', 'Pensión'),
          col('cuspp', 'CUSPP'), col('regimen_laboral', 'Régimen laboral'), col('regimen_salud', 'Salud'), col('eps', 'EPS'),
          col('sctr_txt', 'SCTR'), col('periodicidad_pago', 'Periodicidad'), col('banco', 'Banco'), col('cuenta_sueldo', 'Cuenta'),
          col('cci', 'CCI'),
          col('dias_laborables', 'Días laborables', 'entero'), col('asistencias', 'Asistencias', 'entero'),
          col('faltas', 'Faltas', 'entero'), col('permisos_sin_goce', 'Permisos sin goce', 'entero'),
          col('licencias_sin_goce', 'Licencias sin goce', 'entero'), col('no_remunerados', 'Días no remunerados', 'entero'),
          col('minutos_tardanza', 'Min. tardanza', 'entero'), col('horas_extra', 'Horas extra', 'entero'),
          col('feriados_trabajados', 'Descansos/feriados trabajados', 'entero'), col('vacaciones', 'Días de vacaciones', 'entero'),
          col('descanso_medico', 'Días de descanso médico', 'entero'), col('licencias_con_goce', 'Licencias con goce', 'entero'),
        ],
        filas: filas.map((r) => ({ ...r, sctr_txt: r.sctr ? `${r.sctr_salud} / ${r.sctr_pension}` : 'No' })),
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
