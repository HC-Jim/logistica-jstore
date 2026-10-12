import {
  AFPS, AREAS, BANCOS, CATEGORIAS_LICENCIA, CATEGORIAS_OCUPACIONALES, COMISIONES_AFP, CONTRATOS_SIN_FIN,
  EDUCACION_CON_ESTUDIOS, ESTADOS_CIVILES, ESTADOS_SOLICITUD, JORNADAS, MOTIVOS_CESE, PERIODICIDADES_PAGO,
  REGIMENES_LABORALES, REGIMENES_SALUD, RMV, SCTR_PENSION, SCTR_SALUD, SISTEMAS_PENSION, SITUACIONES_EDUCATIVAS,
  SITUACIONES_ESPECIALES, TASA_ESSALUD, TIPOS_CONTRATO, TIPOS_DOCUMENTO_IDENTIDAD, TIPOS_DOCUMENTO_RRHH, TIPOS_PAGO,
  TIPOS_SOLICITUD, VINCULOS_DERECHOHABIENTE,
} from '../config/catalogos.js';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { COLUMNAS_RESERVADAS, RrhhModel } from '../models/rrhh.model.js';
import { asistenciaDiaria, resumirAsistencia } from '../services/asistencia.service.js';
import { notificar, usuariosConRol } from '../services/notificaciones.service.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError, idParam } from '../utils/http.js';
import { tiene } from '../utils/roles.js';

const TZ = env.timezone;

const CAMPOS_FICHA = {
  usuario_id: { tipo: 'entero' },
  // datos personales
  nombres: { tipo: 'texto', max: 80, requerido: true },
  apellido_paterno: { tipo: 'texto', max: 60, requerido: true },
  apellido_materno: { tipo: 'texto', max: 60 },
  tipo_documento: { tipo: 'enum', lista: TIPOS_DOCUMENTO_IDENTIDAD, requerido: true },
  numero_documento: { tipo: 'texto', max: 15, requerido: true },
  pais_emisor: { tipo: 'texto', max: 40 },
  nacionalidad: { tipo: 'texto', max: 40 },
  fecha_nacimiento: { tipo: 'fecha' },
  sexo: { tipo: 'enum', lista: ['M', 'F'] },
  estado_civil: { tipo: 'enum', lista: ESTADOS_CIVILES },
  telefono: { tipo: 'texto', max: 30 },
  email_personal: { tipo: 'texto', max: 160 },
  direccion: { tipo: 'texto', max: 255 },
  direccion_referencia: { tipo: 'texto', max: 255 },
  ubigeo: { tipo: 'ubigeo' },
  situacion_educativa: { tipo: 'enum', lista: SITUACIONES_EDUCATIVAS },
  institucion_educativa: { tipo: 'texto', max: 120 },
  carrera: { tipo: 'texto', max: 120 },
  anio_egreso: { tipo: 'entero' },
  discapacidad: { tipo: 'booleano' },
  carne_conadis: { tipo: 'texto', max: 20 },
  emergencia_nombre: { tipo: 'texto', max: 120 },
  emergencia_parentesco: { tipo: 'texto', max: 40 },
  emergencia_telefono: { tipo: 'texto', max: 30 },
  // datos laborales
  cargo: { tipo: 'texto', max: 80, requerido: true },
  area: { tipo: 'enum', lista: AREAS, requerido: true },
  jefe_id: { tipo: 'entero' },
  horario_id: { tipo: 'entero' },
  regimen_laboral: { tipo: 'enum', lista: REGIMENES_LABORALES },
  categoria_ocupacional: { tipo: 'enum', lista: CATEGORIAS_OCUPACIONALES },
  ocupacion: { tipo: 'texto', max: 120 },
  situacion_especial: { tipo: 'enum', lista: SITUACIONES_ESPECIALES },
  jornada: { tipo: 'enum', lista: JORNADAS },
  jornada_atipica: { tipo: 'booleano' },
  horario_nocturno: { tipo: 'booleano' },
  sindicalizado: { tipo: 'booleano' },
  fecha_ingreso: { tipo: 'fecha', requerido: true },
  periodo_prueba_fin: { tipo: 'fecha' },
  tipo_contrato: { tipo: 'enum', lista: TIPOS_CONTRATO, requerido: true },
  contrato_fin: { tipo: 'fecha' },
  // remuneración y cuentas
  sueldo: { tipo: 'monto' },
  periodicidad_pago: { tipo: 'enum', lista: PERIODICIDADES_PAGO },
  tipo_pago: { tipo: 'enum', lista: TIPOS_PAGO },
  asignacion_familiar: { tipo: 'booleano' },
  banco: { tipo: 'enum', lista: BANCOS },
  cuenta_sueldo: { tipo: 'texto', max: 30 },
  cci: { tipo: 'texto', max: 25 },
  banco_cts: { tipo: 'enum', lista: [...BANCOS, 'Caja municipal', 'Financiera'] },
  cuenta_cts: { tipo: 'texto', max: 30 },
  // seguridad social
  regimen_salud: { tipo: 'enum', lista: REGIMENES_SALUD },
  eps: { tipo: 'texto', max: 40 },
  sistema_pension: { tipo: 'enum', lista: SISTEMAS_PENSION },
  afp: { tipo: 'enum', lista: AFPS },
  comision_afp: { tipo: 'enum', lista: COMISIONES_AFP },
  cuspp: { tipo: 'texto', max: 15 },
  pension_fecha_inscripcion: { tipo: 'fecha' },
  sctr: { tipo: 'booleano' },
  sctr_salud: { tipo: 'enum', lista: SCTR_SALUD },
  sctr_pension: { tipo: 'enum', lista: SCTR_PENSION },
  sctr_vence: { tipo: 'fecha' },
  vida_ley: { tipo: 'booleano' },
  vida_ley_aseguradora: { tipo: 'texto', max: 60 },
  examen_medico_vence: { tipo: 'fecha' },
  // conductores
  licencia_numero: { tipo: 'texto', max: 15 },
  licencia_categoria: { tipo: 'enum', lista: CATEGORIAS_LICENCIA },
  licencia_vence: { tipo: 'fecha' },
  record_conductor: { tipo: 'texto', max: 2000 },
  // vacaciones y cese
  vacaciones_ajuste: { tipo: 'decimal' },
  fecha_cese: { tipo: 'fecha' },
  motivo_cese: { tipo: 'enum', lista: MOTIVOS_CESE },
  activo: { tipo: 'booleano' },
  observaciones: { tipo: 'texto', max: 2000 },
};

const CAMPOS_DERECHOHABIENTE = {
  vinculo: { tipo: 'enum', lista: VINCULOS_DERECHOHABIENTE, requerido: true },
  tipo_documento: { tipo: 'enum', lista: TIPOS_DOCUMENTO_IDENTIDAD },
  numero_documento: { tipo: 'texto', max: 15 },
  nombres: { tipo: 'texto', max: 80, requerido: true },
  apellido_paterno: { tipo: 'texto', max: 60, requerido: true },
  apellido_materno: { tipo: 'texto', max: 60 },
  fecha_nacimiento: { tipo: 'fecha' },
  sexo: { tipo: 'enum', lista: ['M', 'F'] },
  documento_vinculo: { tipo: 'texto', max: 60 },
  estudia: { tipo: 'booleano' },
  activo: { tipo: 'booleano' },
};

// Archivos que se aceptan como documento (Vercel acepta hasta 4,5 MB por petición)
const MIME_DOCUMENTO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const esRrhh = (u) => tiene(u, 'admin', 'rrhh');
const NOMBRES_TIPO = { vacaciones: 'Vacaciones', permiso: 'Permiso', descanso_medico: 'Descanso médico', licencia: 'Licencia' };

/** Sin sueldo, banco ni datos personales (lo que ve un jefe de su equipo). */
const sinReservados = (c) => c && Object.fromEntries(Object.entries(c).filter(([k]) => !COLUMNAS_RESERVADAS.includes(k)));

/**
 * Colaboradores que el usuario puede ver: RRHH todos (null); un jefe, su equipo.
 * Si no es ninguno de los dos responde 403.
 */
async function alcance(user) {
  if (esRrhh(user)) return null;
  if (tiene(user, 'jefe')) {
    const yo = await RrhhModel.deUsuario(user.id);
    return yo ? RrhhModel.equipoDe(yo.id) : [];
  }
  throw new HttpError(403, 'No tienes permisos');
}

async function miFicha(user) {
  const c = await RrhhModel.deUsuario(user.id);
  if (!c) throw new HttpError(404, 'Tu usuario no está vinculado a una ficha de colaborador. Pide a RRHH que la vincule.');
  if (!c.activo) throw new HttpError(403, 'Tu ficha de colaborador está inactiva');
  return c;
}

function rangoFechas(q, { maxDias = 93 } = {}) {
  const mes = /^\d{4}-\d{2}$/.test(q.mes ?? '') ? q.mes : null;
  const desde = q.desde || (mes ? `${mes}-01` : `${hoy().slice(0, 8)}01`);
  let hasta = q.hasta;
  if (!hasta) {
    const fin = new Date(`${desde.slice(0, 7)}-01T12:00:00Z`);
    fin.setUTCMonth(fin.getUTCMonth() + 1, 0);
    hasta = fin.toISOString().slice(0, 10);
  }
  const f = leerCampos({ desde, hasta }, { desde: { tipo: 'fecha' }, hasta: { tipo: 'fecha' } });
  if (f.desde > f.hasta) throw new HttpError(400, 'La fecha "desde" es posterior a "hasta"');
  if ((new Date(f.hasta) - new Date(f.desde)) / 86400000 >= maxDias) throw new HttpError(400, `El rango no puede pasar de ${maxDias} días`);
  return f;
}

/** Distancia en metros entre dos puntos (para revisar marcaciones lejos del almacén). */
function distancia(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

/** Meses que dura el periodo de prueba (D. Leg. 728): 3; confianza 6; dirección 12. */
const mesesPrueba = (situacion) => (situacion === 'Trabajador de dirección' ? 12 : situacion === 'Trabajador de confianza' ? 6 : 3);
const sumarMeses = (iso, meses) => {
  const f = new Date(`${iso}T12:00:00Z`);
  f.setUTCMonth(f.getUTCMonth() + meses);
  return f.toISOString().slice(0, 10);
};

/**
 * Normaliza y valida la ficha. `actual` es la ficha guardada (al editar): las reglas que combinan
 * varios campos usan el valor nuevo si llegó y si no el guardado.
 */
async function validarFicha(d, actual = null) {
  const id = actual?.id ?? null;
  const v = (k) => (k in d ? d[k] : actual?.[k]);
  // vacíos en columnas obligatorias: se usa el valor por defecto
  for (const k of ['sueldo', 'vacaciones_ajuste']) if (d[k] === null) d[k] = 0;
  for (const k of ['sistema_pension', 'asignacion_familiar', 'activo', 'regimen_laboral', 'categoria_ocupacional',
    'situacion_especial', 'jornada', 'periodicidad_pago', 'tipo_pago', 'regimen_salud', 'discapacidad', 'jornada_atipica',
    'horario_nocturno', 'sindicalizado', 'sctr', 'vida_ley', 'nacionalidad']) if (d[k] === null) delete d[k];

  if (d.numero_documento) d.numero_documento = d.numero_documento.toUpperCase().replace(/\s/g, '');
  const tipoDoc = v('tipo_documento');
  const numDoc = v('numero_documento');
  if (tipoDoc === 'DNI' && numDoc && !/^\d{8}$/.test(numDoc)) throw new HttpError(400, 'El DNI debe tener 8 dígitos');
  if (tipoDoc !== 'DNI' && numDoc && !/^[A-Z0-9]{6,12}$/.test(numDoc)) throw new HttpError(400, 'El documento debe tener de 6 a 12 letras o números');
  if (tipoDoc && tipoDoc !== 'DNI' && !v('pais_emisor')) throw new HttpError(400, 'Indica el país emisor del documento');
  if (d.fecha_nacimiento && d.fecha_nacimiento > hoy()) throw new HttpError(400, 'La fecha de nacimiento es futura');
  if (EDUCACION_CON_ESTUDIOS.includes(v('situacion_educativa')) && !v('institucion_educativa')) {
    throw new HttpError(400, 'Con estudios superiores completos el T-Registro pide la institución y la carrera');
  }
  if (d.discapacidad === false) d.carne_conadis = null;

  // contrato y periodo de prueba
  if (CONTRATOS_SIN_FIN.includes(v('tipo_contrato'))) { if (v('tipo_contrato') === 'Plazo indeterminado') d.contrato_fin = null; }
  else if (!v('contrato_fin')) throw new HttpError(400, 'Los contratos sujetos a modalidad necesitan fecha de fin');
  if (!id && !d.periodo_prueba_fin && d.fecha_ingreso && !v('tipo_contrato')?.startsWith('Convenio') && !v('tipo_contrato')?.startsWith('Locación')) {
    d.periodo_prueba_fin = sumarMeses(d.fecha_ingreso, mesesPrueba(v('situacion_especial')));
  }
  if (d.jefe_id && (await RrhhModel.creariaCiclo(id, d.jefe_id))) throw new HttpError(400, 'El jefe elegido depende de este colaborador');

  // remuneración
  if (d.cci && !/^\d{20}$/.test(d.cci.replace(/[\s-]/g, ''))) throw new HttpError(400, 'El CCI debe tener 20 dígitos');
  if (d.cci) d.cci = d.cci.replace(/[\s-]/g, '');
  if (!id && v('regimen_laboral') === 'MYPE - Microempresa' && !('regimen_salud' in d)) d.regimen_salud = 'SIS - Microempresa';
  if (v('regimen_salud') !== 'EsSalud + EPS') d.eps = null;

  // pensiones
  if (v('sistema_pension') !== 'AFP') { d.afp = null; d.comision_afp = null; d.cuspp = null; }
  else {
    if (!v('afp')) throw new HttpError(400, 'Elige la AFP');
    if (!v('comision_afp')) throw new HttpError(400, 'Indica el tipo de comisión de la AFP (flujo o mixta)');
    if (d.cuspp && !/^[A-Z0-9]{12}$/.test(d.cuspp.toUpperCase())) throw new HttpError(400, 'El CUSPP tiene 12 caracteres');
    if (d.cuspp) d.cuspp = d.cuspp.toUpperCase();
  }
  if (v('sistema_pension') === 'Sin sistema') d.pension_fecha_inscripcion = null;

  // SCTR
  if (v('sctr') === false) { d.sctr_salud = null; d.sctr_pension = null; d.sctr_vence = null; }
  else if (v('sctr') && (!v('sctr_salud') || !v('sctr_pension'))) throw new HttpError(400, 'Con SCTR indica la cobertura de salud y de pensión');

  // cese
  if (d.fecha_cese) {
    d.activo = false;
    if (!v('motivo_cese')) throw new HttpError(400, 'Indica el motivo del cese');
  }
  if (d.activo === true) { d.fecha_cese = null; d.motivo_cese = null; }
}

/** Lee los datos de una solicitud y valida fechas y saldo de vacaciones. */
async function leerSolicitud(body, colaborador, { esRrhhUsuario }) {
  const d = leerCampos(body, {
    tipo: { tipo: 'enum', lista: TIPOS_SOLICITUD, requerido: true },
    desde: { tipo: 'fecha', requerido: true },
    hasta: { tipo: 'fecha', requerido: true },
    con_goce: { tipo: 'booleano' },
    motivo: { tipo: 'texto', max: 500 },
  }, { requeridos: true });
  if (d.hasta < d.desde) throw new HttpError(400, 'La fecha final es anterior a la inicial');
  if ((new Date(d.hasta) - new Date(d.desde)) / 86400000 > 365) throw new HttpError(400, 'Una solicitud no puede pasar de un año');
  if (d.desde < colaborador.fecha_ingreso) throw new HttpError(400, 'La fecha es anterior al ingreso del colaborador');
  // vacaciones y descansos médicos son siempre con goce
  const conGoce = ['vacaciones', 'descanso_medico'].includes(d.tipo) ? true : (d.con_goce ?? true);
  if (!esRrhhUsuario) {
    // el colaborador no registra vacaciones ni permisos en el pasado (los descansos médicos sí, hasta 30 días)
    const limite = new Date(`${hoy()}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() - (d.tipo === 'descanso_medico' ? 30 : 0));
    if (d.desde < limite.toISOString().slice(0, 10)) throw new HttpError(400, 'La fecha de inicio ya pasó; pide a RRHH que la registre');
    if (d.tipo !== 'vacaciones' && !d.motivo) throw new HttpError(400, 'Indica el motivo');
  }
  if (d.tipo === 'vacaciones') {
    const v = (await RrhhModel.vacaciones([colaborador.id]))[colaborador.id];
    const dias = (new Date(d.hasta) - new Date(d.desde)) / 86400000 + 1;
    if (dias > v.disponible && !esRrhhUsuario) {
      throw new HttpError(400, `Pides ${dias} días y tu saldo disponible es ${v.disponible}`);
    }
  }
  return { tipo: d.tipo, desde: d.desde, hasta: d.hasta, motivo: d.motivo, conGoce };
}

async function avisarSolicitudNueva(s, user) {
  const jefe = s.jefe_id ? await RrhhModel.obtener(s.jefe_id) : null;
  await notificar([jefe?.usuario_id, ...(await usuariosConRol(['rrhh']))], {
    tipo: 'rrhh_solicitud',
    titulo: `${NOMBRES_TIPO[s.tipo]}: ${s.colaborador}`,
    cuerpo: `Del ${s.desde} al ${s.hasta} (${s.dias} día${s.dias === 1 ? '' : 's'})${s.motivo ? ` · ${s.motivo}` : ''}`,
    url: '/rrhh/solicitudes',
    datos: { solicitud_id: s.id },
  }, { excepto: user.id });
}

/** Valida y lee el archivo subido (el cuerpo de la petición es el archivo). */
function leerArchivo(req) {
  const mime = (req.headers['content-type'] ?? '').split(';')[0].trim();
  if (!MIME_DOCUMENTO.includes(mime)) throw new HttpError(415, 'El archivo debe ser PDF, JPG, PNG o WEBP');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'No llegó el archivo');
  return { mime, contenido: req.body };
}

export const RrhhController = {
  // ---------------- fichas ----------------

  async listar(req, res) {
    const ids = await alcance(req.user);
    const f = leerCampos(req.query, { area: { tipo: 'enum', lista: AREAS }, estado: { tipo: 'enum', lista: ['activos', 'cesados', 'todos'] } });
    const lista = await RrhhModel.listar({ q: req.query.q, area: f.area, estado: f.estado ?? 'activos', ids: ids ?? undefined });
    res.json(ids ? lista.map(sinReservados) : lista);
  },

  async obtener(req, res) {
    const id = idParam(req.params.id);
    const ids = await alcance(req.user);
    if (ids && !ids.includes(id)) throw new HttpError(404, 'Colaborador no encontrado');
    const c = await RrhhModel.obtener(id);
    if (!c) throw new HttpError(404, 'Colaborador no encontrado');
    const vacaciones = (await RrhhModel.vacaciones([id]))[id];
    if (ids) return res.json({ ...sinReservados(c), vacaciones });
    const [documentos, derechohabientes] = await Promise.all([RrhhModel.documentos(id), RrhhModel.derechohabientes(id)]);
    res.json({ ...c, vacaciones, documentos_lista: documentos, derechohabientes });
  },

  // ---------------- derechohabientes ----------------

  /** Crea (POST /colaboradores/:id/derechohabientes) o edita (PUT /derechohabientes/:id). */
  async guardarDerechohabiente(req, res) {
    const editar = Boolean(req.params.dhId);
    const id = editar ? idParam(req.params.dhId) : null;
    const actual = editar ? await RrhhModel.derechohabiente(id) : null;
    if (editar && !actual) throw new HttpError(404, 'Derechohabiente no encontrado');
    const colaboradorId = editar ? actual.colaborador_id : idParam(req.params.id);
    if (!(await RrhhModel.obtener(colaboradorId))) throw new HttpError(404, 'Colaborador no encontrado');
    const d = leerCampos(req.body, CAMPOS_DERECHOHABIENTE, { requeridos: !editar });
    for (const k of ['estudia', 'activo', 'tipo_documento']) if (d[k] === null) delete d[k];
    if (d.numero_documento) d.numero_documento = d.numero_documento.toUpperCase();
    const tipo = d.tipo_documento ?? actual?.tipo_documento ?? 'DNI';
    if (tipo === 'DNI' && d.numero_documento && !/^\d{8}$/.test(d.numero_documento)) throw new HttpError(400, 'El DNI debe tener 8 dígitos');
    if (d.fecha_nacimiento && d.fecha_nacimiento > hoy() && (d.vinculo ?? actual?.vinculo) !== 'Gestante') {
      throw new HttpError(400, 'La fecha de nacimiento es futura');
    }
    await RrhhModel.guardarDerechohabiente(id, colaboradorId, d);
    res.status(editar ? 200 : 201).json(await RrhhModel.derechohabientes(colaboradorId));
  },

  async eliminarDerechohabiente(req, res) {
    const actual = await RrhhModel.derechohabiente(idParam(req.params.dhId));
    if (!actual) throw new HttpError(404, 'Derechohabiente no encontrado');
    await RrhhModel.eliminarDerechohabiente(actual.id);
    res.json(await RrhhModel.derechohabientes(actual.colaborador_id));
  },

  /** Listas para el formulario de la ficha: horarios, posibles jefes y usuarios sin ficha. */
  async opciones(_req, res) {
    const [horarios, jefes, usuarios] = await Promise.all([
      RrhhModel.horarios(),
      query(`SELECT id, concat_ws(' ', nombres, apellido_paterno, apellido_materno) AS nombre, cargo, area FROM colaboradores WHERE activo ORDER BY apellido_paterno, apellido_materno, nombres`),
      query(`SELECT u.id, u.nombre, u.email, u.roles, c.id AS colaborador_id FROM usuarios u
             LEFT JOIN colaboradores c ON c.usuario_id = u.id WHERE NOT u.pendiente ORDER BY u.nombre`),
    ]);
    res.json({ horarios, jefes: jefes.rows, usuarios: usuarios.rows });
  },

  async crear(req, res) {
    const d = leerCampos(req.body, CAMPOS_FICHA, { requeridos: true });
    await validarFicha(d);
    res.status(201).json(await RrhhModel.crear(d));
  },

  async actualizar(req, res) {
    const id = idParam(req.params.id);
    const d = leerCampos(req.body, CAMPOS_FICHA);
    for (const [k, s] of Object.entries(CAMPOS_FICHA)) {
      if (s.requerido && k in d && d[k] == null) throw new HttpError(400, `${k} es requerido`);
    }
    const actual = await RrhhModel.obtener(id);
    if (!actual) throw new HttpError(404, 'Colaborador no encontrado');
    await validarFicha(d, actual);
    const c = await RrhhModel.actualizar(id, d);
    if (!c) throw new HttpError(404, 'Colaborador no encontrado');
    res.json(c);
  },

  // ---------------- documentos ----------------

  /** Cuerpo: el archivo. ?tipo=&nombre=&vence= */
  async subirDocumento(req, res) {
    const colaboradorId = idParam(req.params.id);
    if (!(await RrhhModel.obtener(colaboradorId))) throw new HttpError(404, 'Colaborador no encontrado');
    const d = leerCampos(req.query, {
      tipo: { tipo: 'enum', lista: TIPOS_DOCUMENTO_RRHH, requerido: true },
      nombre: { tipo: 'texto', max: 160, requerido: true },
      vence: { tipo: 'fecha' },
    }, { requeridos: true });
    const archivo = leerArchivo(req);
    res.status(201).json(await RrhhModel.guardarDocumento({ colaboradorId, ...d, ...archivo, usuario: req.user }));
  },

  /** Descarga: RRHH, el propio colaborador, o su jefe si es el certificado de una solicitud. */
  async descargarDocumento(req, res) {
    const doc = await RrhhModel.documento(idParam(req.params.id), { conContenido: true });
    if (!doc) throw new HttpError(404, 'Documento no encontrado');
    let permitido = esRrhh(req.user);
    if (!permitido) {
      const yo = await RrhhModel.deUsuario(req.user.id);
      permitido = yo?.id === doc.colaborador_id
        || (doc.solicitud_id && tiene(req.user, 'jefe') && yo && (await RrhhModel.equipoDe(yo.id)).includes(doc.colaborador_id));
    }
    if (!permitido) throw new HttpError(404, 'Documento no encontrado');
    res.set({
      'Content-Type': doc.mime,
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.nombre)}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(doc.contenido);
  },

  async eliminarDocumento(req, res) {
    if (!(await RrhhModel.eliminarDocumento(idParam(req.params.id)))) throw new HttpError(404, 'Documento no encontrado');
    res.status(204).end();
  },

  async vencimientos(req, res) {
    const dias = Math.min(Math.max(Number(req.query.dias) || 60, 1), 365);
    res.json(await RrhhModel.vencimientos(dias));
  },

  // ---------------- horarios y feriados ----------------

  async horarios(_req, res) {
    res.json(await RrhhModel.horarios());
  },

  async guardarHorario(req, res) {
    const id = req.params.id ? idParam(req.params.id) : null;
    const d = leerCampos(req.body, {
      nombre: { tipo: 'texto', max: 60, requerido: true },
      hora_entrada: { tipo: 'hora', requerido: true },
      hora_salida: { tipo: 'hora', requerido: true },
      tolerancia_min: { tipo: 'natural' },
      refrigerio_min: { tipo: 'natural' },
      activo: { tipo: 'booleano' },
    }, { requeridos: true });
    const dias = [...new Set((Array.isArray(req.body?.dias) ? req.body.dias : []).map(Number))].sort();
    if (!dias.length || dias.some((x) => !Number.isInteger(x) || x < 1 || x > 7)) throw new HttpError(400, 'Elige los días de trabajo');
    if (d.hora_salida <= d.hora_entrada) throw new HttpError(400, 'La salida debe ser posterior a la entrada');
    const r = await RrhhModel.guardarHorario(id, { ...d, tolerancia_min: d.tolerancia_min ?? 5, refrigerio_min: d.refrigerio_min ?? 60, dias, activo: d.activo ?? null });
    if (!r) throw new HttpError(404, 'Horario no encontrado');
    res.status(id ? 200 : 201).json(await RrhhModel.horarios());
  },

  async feriados(req, res) {
    const anio = /^\d{4}$/.test(req.query.anio ?? '') ? Number(req.query.anio) : null;
    res.json(await RrhhModel.feriados(anio));
  },

  async guardarFeriado(req, res) {
    const d = leerCampos(req.body, { fecha: { tipo: 'fecha', requerido: true }, nombre: { tipo: 'texto', max: 80, requerido: true } }, { requeridos: true });
    await RrhhModel.guardarFeriado(d.fecha, d.nombre);
    res.status(201).json(await RrhhModel.feriados(Number(d.fecha.slice(0, 4))));
  },

  async eliminarFeriado(req, res) {
    const { fecha } = leerCampos(req.params, { fecha: { tipo: 'fecha', requerido: true } }, { requeridos: true });
    if (!(await RrhhModel.eliminarFeriado(fecha))) throw new HttpError(404, 'Feriado no encontrado');
    res.status(204).end();
  },

  // ---------------- asistencia ----------------

  /** ?desde=&hasta= (o ?mes=YYYY-MM) &area=&colaborador_id= → { dias, resumen } */
  async asistencia(req, res) {
    const ids = await alcance(req.user);
    const { desde, hasta } = rangoFechas(req.query);
    const f = leerCampos(req.query, { area: { tipo: 'enum', lista: AREAS }, colaborador_id: { tipo: 'entero' } });
    let colaboradorIds = ids;
    if (f.colaborador_id) {
      if (ids && !ids.includes(f.colaborador_id)) throw new HttpError(404, 'Colaborador no encontrado');
      colaboradorIds = [f.colaborador_id];
    }
    const dias = await asistenciaDiaria({ desde, hasta, colaboradorIds, area: f.area });
    res.json({ desde, hasta, dias, resumen: resumirAsistencia(dias) });
  },

  /** Marcaciones de un colaborador en un día (detalle y corrección). */
  async marcaciones(req, res) {
    const ids = await alcance(req.user);
    const f = leerCampos(req.query, { colaborador_id: { tipo: 'entero', requerido: true }, fecha: { tipo: 'fecha', requerido: true } }, { requeridos: true });
    if (ids && !ids.includes(f.colaborador_id)) throw new HttpError(404, 'Colaborador no encontrado');
    res.json(await RrhhModel.marcacionesDelDia(f.colaborador_id, f.fecha));
  },

  /** Marcación manual de RRHH (olvido, falla del reloj). { colaborador_id, fecha, hora, tipo, nota } */
  async marcacionManual(req, res) {
    const d = leerCampos(req.body, {
      colaborador_id: { tipo: 'entero', requerido: true },
      fecha: { tipo: 'fecha', requerido: true },
      hora: { tipo: 'hora', requerido: true },
      tipo: { tipo: 'enum', lista: ['entrada', 'salida'], requerido: true },
      nota: { tipo: 'texto', max: 255, requerido: true },
    }, { requeridos: true });
    if (d.fecha > hoy()) throw new HttpError(400, 'No se puede marcar en una fecha futura');
    if (!(await RrhhModel.obtener(d.colaborador_id))) throw new HttpError(404, 'Colaborador no encontrado');
    const { rows: [{ ts }] } = await query(`SELECT ($1::date + $2::time) AT TIME ZONE '${TZ}' AS ts`, [d.fecha, d.hora]);
    res.status(201).json(await RrhhModel.marcar({
      colaboradorId: d.colaborador_id, tipo: d.tipo, marcadoEn: ts, origen: 'manual', nota: d.nota, usuario: req.user,
    }));
  },

  async eliminarMarcacion(req, res) {
    if (!(await RrhhModel.eliminarMarcacion(idParam(req.params.id)))) throw new HttpError(404, 'Marcación no encontrada');
    res.status(204).end();
  },

  /**
   * Carga del reloj biométrico. { filas: [{ documento, fecha: 'YYYY-MM-DD', hora: 'HH:MM', tipo? }] }
   * El colaborador se identifica por su número de documento.
   */
  async importarMarcaciones(req, res) {
    const lista = req.body?.filas;
    if (!Array.isArray(lista) || !lista.length) throw new HttpError(400, 'No hay filas para importar');
    if (lista.length > 20000) throw new HttpError(400, 'Máximo 20 000 marcaciones por carga');
    const { rows: cols } = await query('SELECT id, upper(numero_documento) AS doc FROM colaboradores');
    const porDoc = new Map(cols.map((c) => [c.doc, c.id]));
    const errores = [];
    const validas = [];
    lista.forEach((f, i) => {
      try {
        const d = leerCampos(f, {
          documento: { tipo: 'texto', max: 15, requerido: true },
          fecha: { tipo: 'fecha', requerido: true },
          hora: { tipo: 'hora', requerido: true },
          tipo: { tipo: 'enum', lista: ['entrada', 'salida', 'marca'] },
        }, { requeridos: true });
        const id = porDoc.get(d.documento.toUpperCase()) ?? porDoc.get(d.documento.toUpperCase().padStart(8, '0'));
        if (!id) throw new HttpError(400, `documento ${d.documento} no tiene ficha`);
        validas.push({ colaborador_id: id, local: `${d.fecha} ${d.hora}`, tipo: d.tipo ?? 'marca' });
      } catch (err) {
        if (errores.length < 50) errores.push(`Fila ${i + 2}: ${err.message}`);
      }
    });
    if (!validas.length) throw new HttpError(400, 'Ninguna fila es válida', errores);
    // hora local de Lima → instante
    const { rows: instantes } = await query(
      `SELECT (x AT TIME ZONE '${TZ}') AS ts FROM unnest($1::timestamp[]) WITH ORDINALITY AS t(x, n) ORDER BY n`,
      [validas.map((v) => v.local)]
    );
    const filas = validas.map((v, i) => ({ ...v, marcado_en: instantes[i].ts }));
    const insertadas = await RrhhModel.importarMarcaciones(filas, req.user);
    res.status(201).json({ recibidas: lista.length, validas: filas.length, insertadas, repetidas: filas.length - insertadas, errores });
  },

  // ---------------- solicitudes ----------------

  async solicitudes(req, res) {
    const ids = await alcance(req.user);
    const f = leerCampos(req.query, {
      estado: { tipo: 'enum', lista: ESTADOS_SOLICITUD }, tipo: { tipo: 'enum', lista: TIPOS_SOLICITUD },
      desde: { tipo: 'fecha' }, hasta: { tipo: 'fecha' }, colaborador_id: { tipo: 'entero' },
    });
    let colaboradorIds = ids ?? undefined;
    if (f.colaborador_id) colaboradorIds = ids && !ids.includes(f.colaborador_id) ? [] : [f.colaborador_id];
    res.json(await RrhhModel.solicitudes({ colaboradorIds, estado: f.estado, tipo: f.tipo, desde: f.desde, hasta: f.hasta }));
  },

  /** RRHH registra una solicitud de cualquier colaborador (p. ej. un descanso médico) y puede aprobarla de una vez. */
  async crearSolicitud(req, res) {
    const { colaborador_id: colaboradorId, aprobar } = leerCampos(req.body, {
      colaborador_id: { tipo: 'entero', requerido: true }, aprobar: { tipo: 'booleano' },
    }, { requeridos: true });
    const colaborador = await RrhhModel.obtener(colaboradorId);
    if (!colaborador) throw new HttpError(404, 'Colaborador no encontrado');
    const d = await leerSolicitud(req.body, colaborador, { esRrhhUsuario: true });
    const s = await RrhhModel.crearSolicitud({ colaboradorId, ...d, aprobada: Boolean(aprobar), usuario: req.user });
    if (!aprobar) await avisarSolicitudNueva(s, req.user);
    else await notificar([colaborador.usuario_id], {
      tipo: 'rrhh_solicitud_resuelta', titulo: `RRHH registró: ${NOMBRES_TIPO[s.tipo]}`,
      cuerpo: `Del ${s.desde} al ${s.hasta}`, url: '/rrhh/mi-espacio',
    }, { excepto: req.user.id });
    res.status(201).json(s);
  },

  /** { estado: 'aprobada' | 'rechazada' | 'anulada', respuesta } — RRHH, o el jefe del colaborador. */
  async resolverSolicitud(req, res) {
    const id = idParam(req.params.id);
    const d = leerCampos(req.body, {
      estado: { tipo: 'enum', lista: ['aprobada', 'rechazada', 'anulada'], requerido: true },
      respuesta: { tipo: 'texto', max: 500 },
    }, { requeridos: true });
    const s = await RrhhModel.solicitud(id);
    if (!s) throw new HttpError(404, 'Solicitud no encontrada');
    const ids = await alcance(req.user);
    if (ids && !ids.includes(s.colaborador_id)) throw new HttpError(404, 'Solicitud no encontrada');
    if (ids && d.estado === 'anulada') throw new HttpError(403, 'Solo RRHH puede anular una solicitud aprobada');
    if (d.estado === 'rechazada' && !d.respuesta) throw new HttpError(400, 'Indica el motivo del rechazo');
    if (d.estado === 'aprobada' && s.tipo === 'vacaciones' && !esRrhh(req.user)) {
      const v = (await RrhhModel.vacaciones([s.colaborador_id]))[s.colaborador_id];
      if (s.dias > v.saldo) throw new HttpError(400, `El saldo de vacaciones (${v.saldo} días) no alcanza; debe aprobarlo RRHH`);
    }
    const r = await RrhhModel.resolverSolicitud(id, { ...d, usuario: req.user });
    await notificar([s.usuario_id], {
      tipo: 'rrhh_solicitud_resuelta',
      titulo: `${NOMBRES_TIPO[s.tipo]} ${d.estado}`,
      cuerpo: `Del ${s.desde} al ${s.hasta}${d.respuesta ? ` · ${d.respuesta}` : ''}`,
      url: '/rrhh/mi-espacio',
      datos: { solicitud_id: s.id },
    }, { excepto: req.user.id });
    res.json(r);
  },

  // ---------------- calendario del equipo ----------------

  /** ?mes=YYYY-MM → ausencias (aprobadas y pendientes) y feriados del mes. */
  async calendario(req, res) {
    const { desde, hasta } = rangoFechas({ mes: req.query.mes ?? hoy().slice(0, 7) });
    const [ausencias, feriados] = await Promise.all([
      RrhhModel.ausencias(desde, hasta),
      query('SELECT fecha, nombre FROM rrhh_feriados WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha', [desde, hasta]),
    ]);
    res.json({ desde, hasta, ausencias, feriados: feriados.rows });
  },

  /** Usuarios con ausencia aprobada en una fecha (para no armar una ruta sin chofer). ?fecha= */
  async ausentes(req, res) {
    const { fecha } = leerCampos({ fecha: req.query.fecha || hoy() }, { fecha: { tipo: 'fecha' } });
    const lista = await RrhhModel.ausencias(fecha, fecha, { soloAprobadas: true });
    res.json(lista.filter((a) => a.usuario_id).map((a) => ({
      usuario_id: a.usuario_id, colaborador: a.colaborador, tipo: a.tipo, desde: a.desde, hasta: a.hasta,
    })));
  },

  // ---------------- dashboard ----------------

  async dashboard(_req, res) {
    const fecha = hoy();
    const mes = fecha.slice(0, 7);
    const desde30 = new Date(`${fecha}T12:00:00Z`);
    desde30.setUTCDate(desde30.getUTCDate() - 30);
    const ayer = new Date(`${fecha}T12:00:00Z`);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    const [resumen, porArea, porContrato, cumpleanios, pendientes, vencimientos, ausentesHoy, asistenciaHoy, ultimos30] = await Promise.all([
      query(`SELECT COUNT(*) FILTER (WHERE activo)::int AS activos,
                    COUNT(*) FILTER (WHERE to_char(fecha_ingreso, 'YYYY-MM') = $1)::int AS ingresos_mes,
                    COUNT(*) FILTER (WHERE to_char(fecha_cese, 'YYYY-MM') = $1)::int AS ceses_mes,
                    COUNT(*) FILTER (WHERE fecha_cese > $2::date - 365)::int AS ceses_12m,
                    COUNT(*) FILTER (WHERE fecha_ingreso > $2::date - 365)::int AS ingresos_12m,
                    COUNT(*) FILTER (WHERE activo AND usuario_id IS NULL)::int AS sin_usuario,
                    COUNT(*) FILTER (WHERE activo AND horario_id IS NULL)::int AS sin_horario,
                    COALESCE(SUM(sueldo + CASE WHEN asignacion_familiar THEN $3 ELSE 0 END) FILTER (WHERE activo), 0) AS planilla
             FROM colaboradores`, [mes, fecha, RMV * 0.1]),
      query(`SELECT area AS nombre, COUNT(*)::int AS cantidad,
                    SUM(sueldo + CASE WHEN asignacion_familiar THEN $1 ELSE 0 END) AS planilla
             FROM colaboradores WHERE activo GROUP BY area ORDER BY cantidad DESC`, [RMV * 0.1]),
      query(`SELECT tipo_contrato AS nombre, COUNT(*)::int AS cantidad FROM colaboradores WHERE activo GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT id, concat_ws(' ', nombres, apellido_paterno, apellido_materno) AS colaborador, area, fecha_nacimiento,
                    EXTRACT(DAY FROM fecha_nacimiento)::int AS dia
             FROM colaboradores WHERE activo AND EXTRACT(MONTH FROM fecha_nacimiento) = EXTRACT(MONTH FROM $1::date)
             ORDER BY dia`, [fecha]),
      RrhhModel.solicitudes({ estado: 'pendiente' }),
      RrhhModel.vencimientos(30),
      RrhhModel.ausencias(fecha, fecha, { soloAprobadas: true }),
      asistenciaDiaria({ desde: fecha, hasta: fecha }),
      asistenciaDiaria({ desde: desde30.toISOString().slice(0, 10), hasta: ayer.toISOString().slice(0, 10) }),
    ]);
    const r = resumen.rows[0];
    const promedio = r.activos + (r.ceses_12m - r.ingresos_12m) / 2; // aproximación del personal promedio del año
    const contar = (lista, estado) => lista.filter((d) => d.estado === estado).length;
    const porDia = new Map();
    for (const d of ultimos30) {
      if (!porDia.has(d.fecha)) porDia.set(d.fecha, { dia: d.fecha, laborables: 0, faltas: 0, ausencias: 0, tardanzas: 0 });
      const x = porDia.get(d.fecha);
      if (d.laborable) x.laborables++;
      if (d.estado === 'falta') x.faltas++;
      if (['vacaciones', 'permiso', 'descanso_medico', 'licencia'].includes(d.estado) && d.laborable) x.ausencias++;
      if (d.minutos_tardanza > 0) x.tardanzas++;
    }
    const laborables30 = ultimos30.filter((d) => d.laborable).length;
    const faltas30 = contar(ultimos30, 'falta');
    res.json({
      fecha,
      resumen: {
        ...r,
        essalud: Math.round(r.planilla * TASA_ESSALUD * 100) / 100,
        rotacion: promedio > 0 ? Math.round((r.ceses_12m / promedio) * 1000) / 10 : 0,
        ausentismo: laborables30 ? Math.round((faltas30 / laborables30) * 1000) / 10 : 0,
        pendientes: pendientes.length,
      },
      hoy: {
        asistieron: contar(asistenciaHoy, 'asistio'),
        sin_marcar: contar(asistenciaHoy, 'sin_marcar'),
        ausentes: ausentesHoy.length,
        tardanzas: asistenciaHoy.filter((d) => d.minutos_tardanza > 0).length,
        descanso: asistenciaHoy.filter((d) => ['descanso', 'feriado'].includes(d.estado)).length,
      },
      porArea: porArea.rows,
      porContrato: porContrato.rows,
      porDia: [...porDia.values()],
      cumpleanios: cumpleanios.rows,
      pendientes: pendientes.slice(0, 8),
      vencimientos,
      ausentesHoy,
      sinMarcar: asistenciaHoy.filter((d) => d.estado === 'sin_marcar'),
    });
  },

  // ---------------- mi espacio (cada colaborador) ----------------

  async mi(req, res) {
    const c = await RrhhModel.deUsuario(req.user.id);
    if (!c) return res.json({ colaborador: null });
    const fecha = hoy();
    const [vacaciones, marcaciones, horario] = await Promise.all([
      RrhhModel.vacaciones([c.id]),
      RrhhModel.marcacionesDelDia(c.id, fecha),
      c.horario_id ? RrhhModel.horarios().then((h) => h.find((x) => x.id === c.horario_id)) : null,
    ]);
    const { observaciones: _o, vacaciones_ajuste: _v, record_conductor: _r, ...propio } = c;
    res.json({ colaborador: propio, vacaciones: vacaciones[c.id], hoy: { fecha, marcaciones }, horario });
  },

  /** Marcación del propio colaborador desde la web o el celular. { lat, lng, precision, origen: 'web'|'app', tipo? } */
  async marcar(req, res) {
    const c = await miFicha(req.user);
    const d = leerCampos(req.body, {
      lat: { tipo: 'coord', max: 90 }, lng: { tipo: 'coord', max: 180 }, precision: { tipo: 'monto' },
      origen: { tipo: 'enum', lista: ['web', 'app'] }, tipo: { tipo: 'enum', lista: ['entrada', 'salida'] },
    });
    if ((d.lat == null) !== (d.lng == null)) throw new HttpError(400, 'Ubicación incompleta');
    const hoyMarcas = await RrhhModel.marcacionesDelDia(c.id, hoy());
    const ultima = hoyMarcas.at(-1);
    if (ultima && Date.now() - new Date(ultima.marcado_en) < 60_000) throw new HttpError(409, 'Ya marcaste hace menos de un minuto');
    // sin tipo: alterna entrada / salida según la última marcación del día
    const tipo = d.tipo ?? (ultima?.tipo === 'entrada' ? 'salida' : 'entrada');
    const m = await RrhhModel.marcar({
      colaboradorId: c.id, tipo, origen: d.origen ?? 'web', lat: d.lat, lng: d.lng, precision: d.precision,
      distancia: d.lat != null ? distancia(env.deposito, { lat: d.lat, lng: d.lng }) : null, usuario: req.user,
    });
    res.status(201).json(m);
  },

  /** ?mes=YYYY-MM */
  async miAsistencia(req, res) {
    const c = await miFicha(req.user);
    const { desde, hasta } = rangoFechas({ mes: req.query.mes ?? hoy().slice(0, 7) });
    const dias = await asistenciaDiaria({ desde, hasta, colaboradorIds: [c.id] });
    res.json({ desde, hasta, dias, resumen: resumirAsistencia(dias)[0] ?? null });
  },

  async misSolicitudes(req, res) {
    const c = await miFicha(req.user);
    res.json(await RrhhModel.solicitudes({ colaboradorIds: [c.id] }));
  },

  async crearMiSolicitud(req, res) {
    const c = await miFicha(req.user);
    const d = await leerSolicitud(req.body, c, { esRrhhUsuario: false });
    const s = await RrhhModel.crearSolicitud({ colaboradorId: c.id, ...d, aprobada: false, usuario: req.user });
    await avisarSolicitudNueva(s, req.user);
    res.status(201).json(s);
  },

  /** El colaborador retira una solicitud que aún no se atendió. */
  async anularMiSolicitud(req, res) {
    const c = await miFicha(req.user);
    const s = await RrhhModel.solicitud(idParam(req.params.id));
    if (!s || s.colaborador_id !== c.id) throw new HttpError(404, 'Solicitud no encontrada');
    if (s.estado !== 'pendiente') throw new HttpError(409, 'Solo puedes anular solicitudes pendientes; para una aprobada habla con RRHH');
    res.json(await RrhhModel.resolverSolicitud(s.id, { estado: 'anulada', respuesta: 'Anulada por el colaborador', usuario: req.user }));
  },

  /** Certificado médico u otro sustento de la solicitud. Cuerpo: el archivo. ?nombre= */
  async adjuntarMiSolicitud(req, res) {
    const c = await miFicha(req.user);
    const s = await RrhhModel.solicitud(idParam(req.params.id));
    if (!s || s.colaborador_id !== c.id) throw new HttpError(404, 'Solicitud no encontrada');
    const { nombre } = leerCampos(req.query, { nombre: { tipo: 'texto', max: 160, requerido: true } }, { requeridos: true });
    const archivo = leerArchivo(req);
    const tipo = s.tipo === 'descanso_medico' ? 'Certificado médico' : 'Constancia';
    res.status(201).json(await RrhhModel.guardarDocumento({ colaboradorId: c.id, solicitudId: s.id, tipo, nombre, ...archivo, usuario: req.user }));
  },
};
