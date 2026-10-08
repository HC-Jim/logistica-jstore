import { query } from '../config/db.js';

const PUBLICO = 'id, nombre, email, rol, telefono, activo, pendiente, creado_en';

export const UsuarioModel = {
  async buscarPorEmail(email) {
    const { rows } = await query('SELECT * FROM usuarios WHERE email = $1', [email]);
    return rows[0] ?? null;
  },

  async obtener(id) {
    const { rows } = await query(`SELECT ${PUBLICO} FROM usuarios WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async listar({ rol, soloActivos, conClave } = {}) {
    const cond = [];
    const params = [];
    if (rol) { params.push(rol.split(',')); cond.push(`rol = ANY($${params.length}::text[])`); }
    if (soloActivos) cond.push('activo');
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const campos = conClave ? `${PUBLICO}, clave_visible` : PUBLICO;
    const { rows } = await query(`SELECT ${campos} FROM usuarios ${where} ORDER BY nombre`, params);
    return rows;
  },

  async crear({ nombre, email, passwordHash, rol, telefono, pendiente = false, claveVisible = null }) {
    const { rows } = await query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, telefono, activo, pendiente, clave_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $6::boolean IS FALSE, $7) RETURNING ${PUBLICO}`,
      [nombre, email, passwordHash, rol, telefono ?? null, !pendiente, claveVisible]
    );
    return rows[0];
  },

  /** Aprueba una cuenta pendiente (la activa). */
  async aprobar(id) {
    const { rows } = await query(
      `UPDATE usuarios SET pendiente = false, activo = true WHERE id = $1 AND pendiente RETURNING ${PUBLICO}`,
      [id]
    );
    return rows[0] ?? null;
  },

  /** Rechaza (elimina) una cuenta que aún está pendiente. */
  async rechazar(id) {
    const { rowCount } = await query('DELETE FROM usuarios WHERE id = $1 AND pendiente', [id]);
    return rowCount > 0;
  },

  /** Solo cambia los campos enviados (`telefono: null` lo borra; omitirlo lo conserva). */
  async actualizar(id, { nombre, email, rol, telefono, activo, passwordHash, claveVisible }) {
    const { rows } = await query(
      `UPDATE usuarios
       SET nombre = COALESCE($1, nombre), email = COALESCE($2, email), rol = COALESCE($3, rol),
           telefono = CASE WHEN $8 THEN $4 ELSE telefono END,
           activo = COALESCE($5, activo), password_hash = COALESCE($6, password_hash),
           clave_visible = CASE WHEN $6 IS NULL THEN clave_visible ELSE $9 END,
           pendiente = pendiente AND $5 IS NOT TRUE -- activar una cuenta pendiente la aprueba
       WHERE id = $7 RETURNING ${PUBLICO}`,
      [nombre, email, rol, telefono ?? null, activo, passwordHash ?? null, id, telefono !== undefined, claveVisible ?? null]
    );
    return rows[0] ?? null;
  },
};
