import { diasVacacionesAnio } from '../config/catalogos.js';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

// Columnas de la ficha que se pueden escribir (el controlador las valida con leerCampos)
export const COLUMNAS_FICHA = [
  'usuario_id', 'nombres', 'apellido_paterno', 'apellido_materno', 'tipo_documento', 'numero_documento', 'pais_emisor',
  'nacionalidad', 'fecha_nacimiento', 'sexo', 'estado_civil', 'telefono', 'email_personal', 'direccion', 'direccion_referencia',
  'ubigeo', 'situacion_educativa', 'institucion_educativa', 'carrera', 'anio_egreso', 'discapacidad', 'carne_conadis',
  'emergencia_nombre', 'emergencia_parentesco', 'emergencia_telefono',
  'cargo', 'area', 'jefe_id', 'horario_id', 'regimen_laboral', 'categoria_ocupacional', 'ocupacion', 'situacion_especial',
  'jornada', 'jornada_atipica', 'horario_nocturno', 'sindicalizado', 'fecha_ingreso', 'periodo_prueba_fin', 'tipo_contrato',
  'contrato_fin', 'sueldo', 'periodicidad_pago', 'tipo_pago', 'asignacion_familiar', 'banco', 'cuenta_sueldo', 'cci',
  'banco_cts', 'cuenta_cts', 'regimen_salud', 'eps', 'sistema_pension', 'afp', 'comision_afp', 'cuspp',
  'pension_fecha_inscripcion', 'sctr', 'sctr_salud', 'sctr_pension', 'sctr_vence', 'vida_ley', 'vida_ley_aseguradora',
  'examen_medico_vence', 'licencia_numero', 'licencia_categoria', 'licencia_vence', 'record_conductor', 'vacaciones_ajuste',
  'fecha_cese', 'motivo_cese', 'activo', 'observaciones',
];

// Datos que solo ve RRHH (sueldo, banco, pensiones, salud, datos personales)
export const COLUMNAS_RESERVADAS = [
  'numero_documento', 'pais_emisor', 'fecha_nacimiento', 'estado_civil', 'email_personal', 'direccion', 'direccion_referencia',
  'ubigeo', 'discapacidad', 'carne_conadis', 'emergencia_nombre', 'emergencia_parentesco', 'emergencia_telefono',
  'sindicalizado', 'sueldo', 'periodicidad_pago', 'tipo_pago', 'asignacion_familiar', 'banco', 'cuenta_sueldo', 'cci',
  'banco_cts', 'cuenta_cts', 'regimen_salud', 'eps', 'sistema_pension', 'afp', 'comision_afp', 'cuspp',
  'pension_fecha_inscripcion', 'vida_ley_aseguradora', 'record_conductor', 'vacaciones_ajuste', 'motivo_cese', 'observaciones',
];

const TZ = env.timezone;

/**
 * Vencimientos de cada ficha (contrato, licencia, SCTR, examen médico y documentos con fecha).
 * Devuelve una fila por vencimiento: { colaborador_id, concepto, vence }.
 */
const SQL_VENCIMIENTOS = `
  SELECT c.id AS colaborador_id, x.concepto, x.vence
  FROM colaboradores c
  CROSS JOIN LATERAL (VALUES
    ('Contrato', c.contrato_fin), ('Licencia de conducir', c.licencia_vence),
    ('SCTR', c.sctr_vence), ('Examen médico', c.examen_medico_vence),
    -- el fin del periodo de prueba solo avisa antes de que llegue
    ('Fin del periodo de prueba', CASE WHEN c.periodo_prueba_fin >= (now() AT TIME ZONE '${env.timezone}')::date THEN c.periodo_prueba_fin END)
  ) AS x(concepto, vence)
  WHERE c.activo AND x.vence IS NOT NULL
  UNION ALL
  SELECT d.colaborador_id, d.tipo || ': ' || d.nombre, d.vence
  FROM rrhh_documentos d JOIN colaboradores c ON c.id = d.colaborador_id
  WHERE c.activo AND d.vence IS NOT NULL
    -- solo el documento más reciente de cada tipo (el contrato renovado reemplaza al anterior)
    AND d.id = (SELECT MAX(d2.id) FROM rrhh_documentos d2 WHERE d2.colaborador_id = d.colaborador_id AND d2.tipo = d.tipo)`;

export const RrhhModel = {
  // ---------------- fichas ----------------

  async listar({ q, area, estado = 'activos', ids } = {}) {
    const cond = [];
    const params = [];
    const agregar = (sql, v) => { params.push(v); cond.push(sql.replaceAll('?', `$${params.length}`)); };
    if (q) agregar("(concat_ws(' ', c.nombres, c.apellido_paterno, c.apellido_materno) ILIKE ? OR c.numero_documento ILIKE ? OR c.cargo ILIKE ?)", `%${q}%`);
    if (area) agregar('c.area = ?', area);
    if (estado === 'activos') cond.push('c.activo');
    if (estado === 'cesados') cond.push('NOT c.activo');
    if (ids) agregar('c.id = ANY(?::int[])', ids);
    const { rows } = await query(
      `WITH venc AS (${SQL_VENCIMIENTOS})
       SELECT c.*, concat_ws(' ', c.nombres, c.apellido_paterno, c.apellido_materno) AS nombre_completo,
              u.email AS usuario_email, u.nombre AS usuario_nombre, u.roles AS usuario_roles,
              concat_ws(' ', j.nombres, j.apellido_paterno, j.apellido_materno) AS jefe_nombre, h.nombre AS horario_nombre,
              (SELECT COUNT(*) FROM rrhh_documentos d WHERE d.colaborador_id = c.id)::int AS documentos,
              (SELECT json_agg(json_build_object('concepto', v.concepto, 'vence', v.vence) ORDER BY v.vence)
                 FROM venc v WHERE v.colaborador_id = c.id
                  AND v.vence <= (now() AT TIME ZONE '${TZ}')::date + 30) AS alertas
       FROM colaboradores c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN colaboradores j ON j.id = c.jefe_id
       LEFT JOIN rrhh_horarios h ON h.id = c.horario_id
       ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
       ORDER BY c.activo DESC, c.apellido_paterno, c.apellido_materno, c.nombres`,
      params
    );
    return rows;
  },

  async obtener(id) {
    const [c] = await this.listar({ ids: [id], estado: 'todos' });
    return c ?? null;
  },

  async deUsuario(usuarioId) {
    const { rows } = await query('SELECT id FROM colaboradores WHERE usuario_id = $1', [usuarioId]);
    return rows[0] ? this.obtener(rows[0].id) : null;
  },

  /** Ids de todo el equipo a cargo (subordinados directos e indirectos) de un colaborador. */
  async equipoDe(colaboradorId) {
    const { rows } = await query(
      `WITH RECURSIVE eq AS (
         SELECT id FROM colaboradores WHERE jefe_id = $1
         UNION SELECT c.id FROM colaboradores c JOIN eq ON c.jefe_id = eq.id
       ) SELECT id FROM eq`,
      [colaboradorId]
    );
    return rows.map((r) => r.id);
  },

  async crear(datos) {
    const cols = COLUMNAS_FICHA.filter((c) => datos[c] !== undefined);
    const { rows: [r] } = await query(
      `INSERT INTO colaboradores (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      cols.map((c) => datos[c])
    );
    return this.obtener(r.id);
  },

  async actualizar(id, datos) {
    const cols = COLUMNAS_FICHA.filter((c) => datos[c] !== undefined);
    if (!cols.length) return this.obtener(id);
    const { rowCount } = await query(
      `UPDATE colaboradores SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, actualizado_en = now() WHERE id = $1`,
      [id, ...cols.map((c) => datos[c])]
    );
    return rowCount ? this.obtener(id) : null;
  },

  /** ¿Asignar este jefe crearía un ciclo (el jefe es subordinado del colaborador)? */
  async creariaCiclo(colaboradorId, jefeId) {
    if (!jefeId || !colaboradorId) return false;
    if (jefeId === colaboradorId) return true;
    return (await this.equipoDe(colaboradorId)).includes(jefeId);
  },

  /** Vencimientos de todo el personal activo hasta `dias` días adelante (incluye los ya vencidos). */
  async vencimientos(dias = 60) {
    const { rows } = await query(
      `SELECT v.*, concat_ws(' ', c.nombres, c.apellido_paterno, c.apellido_materno) AS colaborador, c.area, c.cargo,
              v.vence - (now() AT TIME ZONE '${TZ}')::date AS dias_restantes
       FROM (${SQL_VENCIMIENTOS}) v JOIN colaboradores c ON c.id = v.colaborador_id
       WHERE v.vence <= (now() AT TIME ZONE '${TZ}')::date + $1::int
       ORDER BY v.vence, colaborador`,
      [dias]
    );
    return rows;
  },

  // ---------------- vacaciones ----------------

  /**
   * Saldo de vacaciones: 30 días por año de servicio, devengados a razón de 2,5 días por mes completo
   * (récord vacacional simplificado), más el ajuste manual, menos las vacaciones aprobadas.
   */
  async vacaciones(ids) {
    const { rows } = await query(
      `WITH base AS (
         SELECT c.id, c.fecha_ingreso, c.vacaciones_ajuste, c.regimen_laboral, c.jornada,
                age(LEAST(COALESCE(c.fecha_cese, 'infinity'::date), (now() AT TIME ZONE '${TZ}')::date), c.fecha_ingreso) AS servicio
         FROM colaboradores c WHERE c.id = ANY($1::int[])
       )
       SELECT b.id AS colaborador_id, b.regimen_laboral, b.jornada,
              GREATEST((EXTRACT(YEAR FROM b.servicio) * 12 + EXTRACT(MONTH FROM b.servicio))::int, 0) AS meses_servicio,
              b.vacaciones_ajuste AS ajuste,
              COALESCE(SUM(s.dias) FILTER (WHERE s.estado = 'aprobada' AND s.desde <= (now() AT TIME ZONE '${TZ}')::date), 0)::int AS gozados,
              COALESCE(SUM(s.dias) FILTER (WHERE s.estado = 'aprobada' AND s.desde > (now() AT TIME ZONE '${TZ}')::date), 0)::int AS programados,
              COALESCE(SUM(s.dias) FILTER (WHERE s.estado = 'pendiente'), 0)::int AS pendientes
       FROM base b LEFT JOIN rrhh_solicitudes s ON s.colaborador_id = b.id AND s.tipo = 'vacaciones'
       GROUP BY b.id, b.servicio, b.vacaciones_ajuste, b.regimen_laboral, b.jornada`,
      [ids]
    );
    return Object.fromEntries(rows.map((r) => {
      const diasAnio = diasVacacionesAnio(r.regimen_laboral, r.jornada);
      const devengados = Math.round(r.meses_servicio * (diasAnio / 12) * 10) / 10;
      const saldo = Math.round((devengados + Number(r.ajuste) - r.gozados - r.programados) * 10) / 10;
      const anios = Math.floor(r.meses_servicio / 12);
      return [r.colaborador_id, {
        ...r,
        dias_anio: diasAnio, // 30 en el régimen general, 15 en MYPE
        anios_completos: anios,
        ganados: anios * diasAnio, // derecho adquirido por años completos
        en_curso: Math.round((devengados - anios * diasAnio) * 10) / 10, // proporcional del año en curso
        devengados,
        saldo,
        disponible: Math.round((saldo - r.pendientes) * 10) / 10,
      }];
    }));
  },

  // ---------------- derechohabientes ----------------

  async derechohabientes(colaboradorId) {
    const { rows } = await query(
      `SELECT *, concat_ws(' ', nombres, apellido_paterno, apellido_materno) AS nombre_completo,
              EXTRACT(YEAR FROM age((now() AT TIME ZONE '${TZ}')::date, fecha_nacimiento))::int AS edad
       FROM rrhh_derechohabientes WHERE colaborador_id = $1 ORDER BY activo DESC, fecha_nacimiento NULLS LAST`,
      [colaboradorId]
    );
    return rows;
  },

  async guardarDerechohabiente(id, colaboradorId, d) {
    const cols = Object.keys(d);
    if (id) {
      const { rowCount } = await query(
        `UPDATE rrhh_derechohabientes SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map((c) => d[c])]
      );
      return rowCount > 0;
    }
    await query(
      `INSERT INTO rrhh_derechohabientes (colaborador_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
      [colaboradorId, ...cols.map((c) => d[c])]
    );
    return true;
  },

  async derechohabiente(id) {
    const { rows } = await query('SELECT * FROM rrhh_derechohabientes WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async eliminarDerechohabiente(id) {
    const { rowCount } = await query('DELETE FROM rrhh_derechohabientes WHERE id = $1', [id]);
    return rowCount > 0;
  },

  // ---------------- documentos ----------------

  async documentos(colaboradorId) {
    const { rows } = await query(
      `SELECT d.id, d.colaborador_id, d.solicitud_id, d.tipo, d.nombre, d.vence, d.mime, d.tamano, d.creado_en, u.nombre AS subido_por
       FROM rrhh_documentos d LEFT JOIN usuarios u ON u.id = d.subido_por
       WHERE d.colaborador_id = $1 ORDER BY d.creado_en DESC`,
      [colaboradorId]
    );
    return rows;
  },

  async guardarDocumento({ colaboradorId, solicitudId, tipo, nombre, vence, mime, contenido, usuario }) {
    const { rows: [d] } = await query(
      `INSERT INTO rrhh_documentos (colaborador_id, solicitud_id, tipo, nombre, vence, mime, tamano, contenido, subido_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, colaborador_id, solicitud_id, tipo, nombre, vence, mime, tamano, creado_en`,
      [colaboradorId, solicitudId ?? null, tipo, nombre, vence ?? null, mime, contenido.length, contenido, usuario.id]
    );
    return d;
  },

  async documento(id, { conContenido = false } = {}) {
    const { rows } = await query(
      `SELECT d.id, d.colaborador_id, d.solicitud_id, d.tipo, d.nombre, d.vence, d.mime, d.tamano ${conContenido ? ', d.contenido' : ''}
       FROM rrhh_documentos d WHERE d.id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async eliminarDocumento(id) {
    const { rowCount } = await query('DELETE FROM rrhh_documentos WHERE id = $1', [id]);
    return rowCount > 0;
  },

  // ---------------- horarios y feriados ----------------

  async horarios() {
    const { rows } = await query(
      `SELECT h.*, to_char(h.hora_entrada, 'HH24:MI') AS hora_entrada, to_char(h.hora_salida, 'HH24:MI') AS hora_salida,
              (SELECT COUNT(*) FROM colaboradores c WHERE c.horario_id = h.id AND c.activo)::int AS colaboradores
       FROM rrhh_horarios h ORDER BY h.activo DESC, h.nombre`
    );
    return rows;
  },

  async guardarHorario(id, d) {
    const valores = [d.nombre, d.hora_entrada, d.hora_salida, d.tolerancia_min, d.refrigerio_min, d.dias, d.activo];
    const { rows } = id
      ? await query(
        `UPDATE rrhh_horarios SET nombre = $1, hora_entrada = $2, hora_salida = $3, tolerancia_min = $4, refrigerio_min = $5,
                dias = $6, activo = COALESCE($7, activo) WHERE id = $8 RETURNING id`, [...valores, id])
      : await query(
        `INSERT INTO rrhh_horarios (nombre, hora_entrada, hora_salida, tolerancia_min, refrigerio_min, dias, activo)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true)) RETURNING id`, valores);
    return rows[0] ?? null;
  },

  async feriados(anio) {
    const { rows } = await query(
      `SELECT fecha, nombre FROM rrhh_feriados WHERE $1::int IS NULL OR EXTRACT(YEAR FROM fecha) = $1 ORDER BY fecha`,
      [anio ?? null]
    );
    return rows;
  },

  async guardarFeriado(fecha, nombre) {
    await query(
      'INSERT INTO rrhh_feriados (fecha, nombre) VALUES ($1, $2) ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre',
      [fecha, nombre]
    );
  },

  async eliminarFeriado(fecha) {
    const { rowCount } = await query('DELETE FROM rrhh_feriados WHERE fecha = $1', [fecha]);
    return rowCount > 0;
  },

  // ---------------- marcaciones ----------------

  async marcacionesDelDia(colaboradorId, fecha) {
    const { rows } = await query(
      `SELECT id, tipo, marcado_en, origen, lat, lng, distancia_m, nota
       FROM rrhh_marcaciones WHERE colaborador_id = $1 AND (marcado_en AT TIME ZONE '${TZ}')::date = $2
       ORDER BY marcado_en`,
      [colaboradorId, fecha]
    );
    return rows;
  },

  async marcar({ colaboradorId, tipo, marcadoEn, origen, lat, lng, precision, distancia, nota, usuario }) {
    const { rows: [m] } = await query(
      `INSERT INTO rrhh_marcaciones (colaborador_id, tipo, marcado_en, origen, lat, lng, precision_m, distancia_m, nota, registrado_por)
       VALUES ($1, $2, COALESCE($3, now()), $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, tipo, marcado_en, origen, lat, lng, distancia_m, nota`,
      [colaboradorId, tipo, marcadoEn ?? null, origen, lat ?? null, lng ?? null, precision ?? null, distancia ?? null, nota ?? null, usuario.id]
    );
    return m;
  },

  async eliminarMarcacion(id) {
    const { rowCount } = await query('DELETE FROM rrhh_marcaciones WHERE id = $1', [id]);
    return rowCount > 0;
  },

  /** Carga del reloj biométrico: filas { colaborador_id, marcado_en, tipo }. Las repetidas se ignoran. */
  async importarMarcaciones(filas, usuario) {
    const { rowCount } = await query(
      `INSERT INTO rrhh_marcaciones (colaborador_id, marcado_en, tipo, origen, registrado_por)
       SELECT *, 'biometrico', $4 FROM unnest($1::int[], $2::timestamptz[], $3::text[])
       ON CONFLICT (colaborador_id, marcado_en) DO NOTHING`,
      [filas.map((f) => f.colaborador_id), filas.map((f) => f.marcado_en), filas.map((f) => f.tipo), usuario.id]
    );
    return rowCount;
  },

  // ---------------- solicitudes ----------------

  async solicitudes({ colaboradorIds, estado, tipo, desde, hasta, id } = {}) {
    const cond = [];
    const params = [];
    const agregar = (sql, v) => { params.push(v); cond.push(sql.replaceAll('?', `$${params.length}`)); };
    if (colaboradorIds) agregar('s.colaborador_id = ANY(?::int[])', colaboradorIds);
    if (estado) agregar('s.estado = ?', estado);
    if (tipo) agregar('s.tipo = ?', tipo);
    if (desde) agregar('s.hasta >= ?', desde);
    if (hasta) agregar('s.desde <= ?', hasta);
    if (id) agregar('s.id = ?', id);
    const { rows } = await query(
      `SELECT s.*, concat_ws(' ', c.nombres, c.apellido_paterno, c.apellido_materno) AS colaborador, c.area, c.cargo, c.jefe_id, c.usuario_id,
              cu.roles AS usuario_roles, r.nombre AS resuelto_por_nombre, cr.nombre AS creado_por_nombre,
              (SELECT json_agg(json_build_object('id', d.id, 'nombre', d.nombre, 'mime', d.mime))
                 FROM rrhh_documentos d WHERE d.solicitud_id = s.id) AS documentos
       FROM rrhh_solicitudes s
       JOIN colaboradores c ON c.id = s.colaborador_id
       LEFT JOIN usuarios cu ON cu.id = c.usuario_id
       LEFT JOIN usuarios r ON r.id = s.resuelto_por
       LEFT JOIN usuarios cr ON cr.id = s.creado_por
       ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
       ORDER BY s.estado = 'pendiente' DESC, s.desde DESC, s.id DESC
       LIMIT 1000`,
      params
    );
    return rows;
  },

  async solicitud(id) {
    const [s] = await this.solicitudes({ id });
    return s ?? null;
  },

  /** Crea la solicitud si no se cruza con otra pendiente o aprobada del mismo colaborador. */
  async crearSolicitud({ colaboradorId, tipo, conGoce, desde, hasta, motivo, aprobada, usuario }) {
    const id = await withTransaction(async (client) => {
      // bloquea la ficha para que dos solicitudes simultáneas no se crucen
      await client.query('SELECT id FROM colaboradores WHERE id = $1 FOR UPDATE', [colaboradorId]);
      const { rows: [cruce] } = await client.query(
        `SELECT id, tipo, desde, hasta FROM rrhh_solicitudes
         WHERE colaborador_id = $1 AND estado IN ('pendiente', 'aprobada') AND desde <= $3 AND hasta >= $2 LIMIT 1`,
        [colaboradorId, desde, hasta]
      );
      if (cruce) throw new HttpError(409, `Se cruza con otra solicitud (${cruce.tipo} del ${cruce.desde} al ${cruce.hasta})`);
      const { rows: [s] } = await client.query(
        `INSERT INTO rrhh_solicitudes (colaborador_id, tipo, con_goce, desde, hasta, motivo, estado, resuelto_por, resuelto_en, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [colaboradorId, tipo, conGoce, desde, hasta, motivo ?? null, aprobada ? 'aprobada' : 'pendiente',
          aprobada ? usuario.id : null, aprobada ? new Date() : null, usuario.id]
      );
      return s.id;
    });
    return this.solicitud(id);
  },

  async resolverSolicitud(id, { estado, respuesta, usuario }) {
    const { rowCount } = await query(
      `UPDATE rrhh_solicitudes SET estado = $2, respuesta = $3, resuelto_por = $4, resuelto_en = now()
       WHERE id = $1 AND (estado = 'pendiente' OR ($2 = 'anulada' AND estado = 'aprobada'))`,
      [id, estado, respuesta ?? null, usuario.id]
    );
    if (!rowCount) throw new HttpError(409, 'La solicitud ya fue atendida');
    return this.solicitud(id);
  },

  /** Ausencias aprobadas o pendientes en un rango (calendario del equipo). */
  async ausencias(desde, hasta, { soloAprobadas = false } = {}) {
    const { rows } = await query(
      `SELECT s.id, s.colaborador_id, s.tipo, s.con_goce, s.desde, s.hasta, s.dias, s.estado,
              concat_ws(' ', c.nombres, c.apellido_paterno, c.apellido_materno) AS colaborador, c.area, c.cargo, c.usuario_id, u.roles AS usuario_roles
       FROM rrhh_solicitudes s JOIN colaboradores c ON c.id = s.colaborador_id
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE s.desde <= $2 AND s.hasta >= $1 AND s.estado = ANY($3::text[])
       ORDER BY s.desde, colaborador`,
      [desde, hasta, soloAprobadas ? ['aprobada'] : ['aprobada', 'pendiente']]
    );
    return rows;
  },
};
