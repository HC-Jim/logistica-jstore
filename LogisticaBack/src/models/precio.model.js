import { query, withTransaction } from '../config/db.js';
import { HttpError } from '../utils/http.js';

export const PrecioModel = {
  async plataformas() {
    const { rows } = await query('SELECT * FROM plataformas_precio ORDER BY orden, nombre');
    return rows;
  },

  /**
   * Precio vigente (el de fecha más reciente) de cada producto en cada plataforma.
   * Devuelve una fila por producto con { precios: { Web: { precio, precio_normal, fecha }, ... } }.
   */
  async vigentes({ q, categoriaId, marcaId, productoId, soloActivos = true, limite = 2000 } = {}) {
    const cond = [];
    const params = [];
    const agregar = (sql, valor) => { params.push(valor); cond.push(sql.replaceAll('?', `$${params.length}`)); };
    if (q) agregar('(p.sku ILIKE ? OR p.descripcion ILIKE ?)', `%${q}%`);
    if (categoriaId) agregar('s.categoria_id = ?', categoriaId);
    if (marcaId) agregar('p.marca_id = ?', marcaId);
    if (productoId) agregar('p.id = ?', productoId);
    if (soloActivos) cond.push('p.activo');
    params.push(limite);
    const { rows } = await query(
      `WITH prods AS (
         SELECT p.id, p.sku, p.descripcion, p.tipo, p.precio AS precio_web_ficha, p.precio_normal, p.activo,
                p.estado_sourcing, m.nombre AS marca, COALESCE(m.propia, false) AS marca_propia, c.nombre AS categoria
         FROM productos p
         LEFT JOIN marcas m ON m.id = p.marca_id
         LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
         LEFT JOIN categorias c ON c.id = s.categoria_id
         ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
         ORDER BY p.descripcion LIMIT $${params.length}
       ),
       ult AS (
         SELECT DISTINCT ON (x.producto_id, x.plataforma_id) x.producto_id, pl.nombre AS plataforma, x.fecha, x.precio, x.precio_normal
         FROM precios x JOIN plataformas_precio pl ON pl.id = x.plataforma_id
         WHERE x.producto_id IN (SELECT id FROM prods)
         ORDER BY x.producto_id, x.plataforma_id, x.fecha DESC
       )
       SELECT pr.*, COALESCE(json_object_agg(u.plataforma, json_build_object('precio', u.precio, 'precio_normal', u.precio_normal, 'fecha', u.fecha))
                             FILTER (WHERE u.plataforma IS NOT NULL), '{}') AS precios
       FROM prods pr LEFT JOIN ult u ON u.producto_id = pr.id
       GROUP BY pr.id, pr.sku, pr.descripcion, pr.tipo, pr.precio_web_ficha, pr.precio_normal, pr.activo, pr.estado_sourcing,
                pr.marca, pr.marca_propia, pr.categoria
       ORDER BY pr.descripcion`,
      params
    );
    return rows;
  },

  /** Historial de precios de un producto (todas las plataformas, lo más reciente primero). */
  async historial(productoId, limite = 500) {
    const { rows } = await query(
      `SELECT x.id, x.fecha, x.precio, x.precio_normal, pl.nombre AS plataforma, u.nombre AS registrado_por, x.creado_en,
              CASE WHEN x.precio_normal > 0 THEN ROUND((1 - x.precio / x.precio_normal) * 100, 1) END AS descuento
       FROM precios x
       JOIN plataformas_precio pl ON pl.id = x.plataforma_id
       LEFT JOIN usuarios u ON u.id = x.creado_por
       WHERE x.producto_id = $1
       ORDER BY x.fecha DESC, pl.orden LIMIT $2`,
      [productoId, limite]
    );
    return rows;
  },

  /**
   * Registra precios de un producto en una o varias plataformas para una fecha.
   * Si ya hay precio ese día en esa plataforma, se reemplaza. Actualiza el precio Web de la ficha
   * (el que usan los pedidos) cuando la fecha es la más reciente.
   */
  async registrar({ productoId, fecha, precioNormal, precios, usuario }) {
    return withTransaction(async (client) => {
      const { rows: [prod] } = await client.query('SELECT id FROM productos WHERE id = $1 FOR UPDATE', [productoId]);
      if (!prod) throw new HttpError(404, 'Producto no encontrado');
      const { rows: plats } = await client.query('SELECT id, nombre, activo FROM plataformas_precio WHERE id = ANY($1::int[])', [precios.map((p) => p.plataforma_id)]);
      if (plats.length !== new Set(precios.map((p) => p.plataforma_id)).size) throw new HttpError(400, 'Alguna plataforma no existe');
      const inactiva = plats.find((p) => !p.activo);
      if (inactiva) throw new HttpError(400, `La plataforma ${inactiva.nombre} ya no se usa`);
      await client.query(
        `INSERT INTO precios (producto_id, plataforma_id, fecha, precio, precio_normal, creado_por)
         SELECT $1, * FROM unnest($2::int[], $3::date[], $4::numeric[], $5::numeric[], $6::int[])
         ON CONFLICT (producto_id, plataforma_id, fecha)
         DO UPDATE SET precio = EXCLUDED.precio, precio_normal = EXCLUDED.precio_normal, creado_por = EXCLUDED.creado_por, creado_en = now()`,
        [productoId, precios.map((p) => p.plataforma_id), precios.map(() => fecha), precios.map((p) => p.precio),
          precios.map(() => precioNormal ?? null), precios.map(() => usuario.id)]
      );
      // la ficha guarda el precio Web y el normal vigentes
      await client.query(
        `UPDATE productos p SET
           precio = COALESCE((SELECT x.precio FROM precios x JOIN plataformas_precio pl ON pl.id = x.plataforma_id
                              WHERE x.producto_id = p.id AND pl.nombre = 'Web' ORDER BY x.fecha DESC LIMIT 1), p.precio),
           precio_normal = COALESCE($2, p.precio_normal), actualizado_en = now()
         WHERE p.id = $1`,
        [productoId, precioNormal ?? null]
      );
      return productoId;
    });
  },

  async eliminar(id) {
    const { rowCount } = await query('DELETE FROM precios WHERE id = $1', [id]);
    return rowCount > 0;
  },

  // --- descuentos mayoristas ---

  async descuentos() {
    const { rows } = await query('SELECT * FROM descuentos_mayoristas ORDER BY grupo DESC, tipo_cliente, desde');
    return rows;
  },

  /** Reemplaza la tabla de un grupo (propias u otras). */
  async guardarDescuentos(grupo, tramos) {
    return withTransaction(async (client) => {
      await client.query('DELETE FROM descuentos_mayoristas WHERE grupo = $1', [grupo]);
      if (tramos.length) {
        await client.query(
          `INSERT INTO descuentos_mayoristas (grupo, tipo_cliente, desde, hasta, porcentaje)
           SELECT $1, * FROM unnest($2::text[], $3::int[], $4::int[], $5::numeric[])`,
          [grupo, tramos.map((t) => t.tipo_cliente), tramos.map((t) => t.desde), tramos.map((t) => t.hasta ?? null), tramos.map((t) => t.porcentaje)]
        );
      }
    }).then(() => this.descuentos());
  },
};
