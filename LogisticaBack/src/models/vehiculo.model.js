import { query } from '../config/db.js';

export const VehiculoModel = {
  async listar({ soloActivos } = {}) {
    const { rows } = await query(
      `SELECT v.*, (SELECT COUNT(*) FROM rutas r WHERE r.vehiculo_id = v.id) AS rutas
       FROM vehiculos v ${soloActivos ? 'WHERE v.activo' : ''} ORDER BY v.activo DESC, v.nombre`
    );
    return rows;
  },

  async crear({ nombre, tipo, placa }) {
    const { rows } = await query(
      'INSERT INTO vehiculos (nombre, tipo, placa) VALUES ($1, $2, $3) RETURNING *',
      [nombre, tipo, placa ?? null]
    );
    return rows[0];
  },

  async actualizar(id, { nombre, tipo, placa, activo }) {
    const { rows } = await query(
      `UPDATE vehiculos SET nombre = $1, tipo = $2, placa = $3, activo = COALESCE($4, activo)
       WHERE id = $5 RETURNING *`,
      [nombre, tipo, placa ?? null, activo, id]
    );
    return rows[0] ?? null;
  },
};
