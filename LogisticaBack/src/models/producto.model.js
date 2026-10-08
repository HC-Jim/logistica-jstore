import { query } from '../config/db.js';

export const ProductoModel = {
  /** Búsqueda por SKU o descripción (para el selector del formulario). */
  async listar({ q, soloActivos, limite = 1000 } = {}) {
    const cond = [];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      cond.push(`(sku ILIKE $${params.length} OR descripcion ILIKE $${params.length})`);
    }
    if (soloActivos) cond.push('activo');
    params.push(limite);
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT * FROM productos ${where} ORDER BY descripcion LIMIT $${params.length}`,
      params
    );
    return rows;
  },

  async obtener(id) {
    const { rows } = await query('SELECT * FROM productos WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async crear({ sku, descripcion, precio, activo = true }) {
    const { rows } = await query(
      `INSERT INTO productos (sku, descripcion, precio, activo) VALUES ($1, $2, $3, $4) RETURNING *`,
      [sku, descripcion, precio ?? 0, activo]
    );
    return rows[0];
  },

  async actualizar(id, { sku, descripcion, precio, activo }) {
    const { rows } = await query(
      `UPDATE productos SET sku = $1, descripcion = $2, precio = $3, activo = $4, actualizado_en = now()
       WHERE id = $5 RETURNING *`,
      [sku, descripcion, precio ?? 0, activo ?? true, id]
    );
    return rows[0] ?? null;
  },

  async eliminar(id) {
    const { rowCount } = await query('DELETE FROM productos WHERE id = $1', [id]);
    return rowCount > 0;
  },

  /** Inserta o actualiza por SKU. Devuelve cuántos se crearon y cuántos se actualizaron. */
  async importar(filas) {
    const { rows } = await query(
      `INSERT INTO productos (sku, descripcion, precio)
       SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[])
       ON CONFLICT (sku) DO UPDATE
         SET descripcion = EXCLUDED.descripcion, precio = EXCLUDED.precio, activo = true, actualizado_en = now()
       RETURNING (xmax = 0) AS insertado`,
      [filas.map((f) => f.sku), filas.map((f) => f.descripcion), filas.map((f) => f.precio)]
    );
    const creados = rows.filter((r) => r.insertado).length;
    return { creados, actualizados: rows.length - creados };
  },
};
