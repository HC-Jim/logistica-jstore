import { query } from '../config/db.js';

const PUBLICO = 'id, nombre, email, rol, telefono, activo, creado_en';

export const UsuarioModel = {
  async buscarPorEmail(email) {
    const { rows } = await query('SELECT * FROM usuarios WHERE email = $1', [email]);
    return rows[0] ?? null;
  },

  async obtener(id) {
    const { rows } = await query(`SELECT ${PUBLICO} FROM usuarios WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async listar({ rol, soloActivos } = {}) {
    const cond = [];
    const params = [];
    if (rol) { params.push(rol.split(',')); cond.push(`rol = ANY($${params.length}::text[])`); }
    if (soloActivos) cond.push('activo');
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(`SELECT ${PUBLICO} FROM usuarios ${where} ORDER BY nombre`, params);
    return rows;
  },

  async crear({ nombre, email, passwordHash, rol, telefono }) {
    const { rows } = await query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, telefono)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${PUBLICO}`,
      [nombre, email, passwordHash, rol, telefono ?? null]
    );
    return rows[0];
  },

  async actualizar(id, { nombre, email, rol, telefono, activo, passwordHash }) {
    const { rows } = await query(
      `UPDATE usuarios
       SET nombre = COALESCE($1, nombre), email = COALESCE($2, email), rol = COALESCE($3, rol),
           telefono = $4, activo = COALESCE($5, activo), password_hash = COALESCE($6, password_hash)
       WHERE id = $7 RETURNING ${PUBLICO}`,
      [nombre, email, rol, telefono ?? null, activo, passwordHash ?? null, id]
    );
    return rows[0] ?? null;
  },
};
