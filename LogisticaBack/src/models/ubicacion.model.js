import { query } from '../config/db.js';

const CAMPOS = ['nombre', 'tipo', 'direccion', 'ubigeo', 'referencia', 'contacto', 'telefono', 'lat', 'lng'];

export const UbicacionModel = {
  async listar({ soloActivas } = {}) {
    const { rows } = await query(
      `SELECT u.*, ub.distrito, ub.provincia,
              (SELECT COUNT(*) FROM pedidos p WHERE p.ubicacion_id = u.id OR p.origen_ubicacion_id = u.id) AS usos
       FROM ubicaciones u LEFT JOIN ubigeos ub ON ub.codigo = u.ubigeo
       ${soloActivas ? 'WHERE u.activo' : ''} ORDER BY u.activo DESC, u.nombre`
    );
    return rows;
  },

  async obtener(id) {
    const { rows } = await query('SELECT * FROM ubicaciones WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async crear(datos) {
    const { rows } = await query(
      `INSERT INTO ubicaciones (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      CAMPOS.map((c) => datos[c] ?? null)
    );
    return rows[0];
  },

  async actualizar(id, datos, activo) {
    const { rows } = await query(
      `UPDATE ubicaciones SET ${CAMPOS.map((c, i) => `${c} = $${i + 1}`).join(', ')},
              activo = COALESCE($${CAMPOS.length + 1}, activo)
       WHERE id = $${CAMPOS.length + 2} RETURNING *`,
      [...CAMPOS.map((c) => datos[c] ?? null), activo, id]
    );
    return rows[0] ?? null;
  },
};
