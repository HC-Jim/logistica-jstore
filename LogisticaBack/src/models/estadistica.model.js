import { query } from '../config/db.js';

// Todas las métricas se calculan sobre la fecha de entrega en el rango [desde, hasta].
const RANGO = 'p.fecha_entrega BETWEEN $1 AND $2';
const VALIDO = `p.estado <> 'cancelado'`;

async function filas(sql, params) {
  const { rows } = await query(sql, params);
  return rows;
}

export const EstadisticaModel = {
  async dashboard({ desde, hasta, hoy }) {
    const r = [desde, hasta];
    const [[resumen], [hoyResumen], porEstado, porDia, porPlataforma, porVendedor, porTipo, topProductos, topDistritos] =
      await Promise.all([
        filas(
          `SELECT COUNT(*) AS pedidos,
                  COALESCE(SUM(total_pedido) FILTER (WHERE ${VALIDO}), 0) AS ventas,
                  COUNT(*) FILTER (WHERE estado = 'entregado') AS entregados,
                  COUNT(*) FILTER (WHERE estado = 'cancelado') AS cancelados,
                  COUNT(*) FILTER (WHERE estado = 'incidencia') AS incidencias,
                  COALESCE(SUM(precio_envio) FILTER (WHERE ${VALIDO}), 0) AS envios
           FROM pedidos p WHERE ${RANGO}`,
          r
        ),
        filas(
          `SELECT COUNT(*) FILTER (WHERE estado = 'pendiente') AS sin_rutear,
                  COUNT(*) FILTER (WHERE estado = 'ruteado') AS ruteados,
                  COUNT(*) FILTER (WHERE estado = 'entregado') AS entregados,
                  COUNT(*) FILTER (WHERE estado = 'incidencia') AS incidencias
           FROM pedidos WHERE fecha_entrega = $1`,
          [hoy]
        ),
        filas(`SELECT estado, COUNT(*) AS cantidad FROM pedidos p WHERE ${RANGO} GROUP BY estado`, r),
        filas(
          `SELECT to_char(d, 'YYYY-MM-DD') AS fecha,
                  COUNT(p.id) AS pedidos,
                  COALESCE(SUM(p.total_pedido), 0) AS ventas
           FROM generate_series($1::date, $2::date, interval '1 day') AS d
           LEFT JOIN pedidos p ON p.fecha_entrega = d::date AND ${VALIDO}
           GROUP BY d ORDER BY d`,
          r
        ),
        filas(
          `SELECT plataforma AS nombre, COUNT(*) AS pedidos, SUM(total_pedido) AS ventas
           FROM pedidos p WHERE ${RANGO} AND ${VALIDO} GROUP BY plataforma ORDER BY pedidos DESC`,
          r
        ),
        filas(
          `SELECT u.nombre, COUNT(*) AS pedidos, SUM(p.total_pedido) AS ventas
           FROM pedidos p JOIN usuarios u ON u.id = p.vendedor_id
           WHERE ${RANGO} AND ${VALIDO} GROUP BY u.nombre ORDER BY ventas DESC`,
          r
        ),
        filas(
          `SELECT tipo_pedido AS nombre, COUNT(*) AS pedidos
           FROM pedidos p WHERE ${RANGO} AND ${VALIDO} GROUP BY tipo_pedido ORDER BY pedidos DESC`,
          r
        ),
        filas(
          `SELECT i.sku, i.descripcion, SUM(i.cantidad) AS unidades, SUM(i.subtotal) AS ventas
           FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
           WHERE ${RANGO} AND ${VALIDO}
           GROUP BY i.sku, i.descripcion ORDER BY unidades DESC LIMIT 10`,
          r
        ),
        filas(
          `SELECT COALESCE(ub.distrito, 'Sin distrito') AS nombre, COUNT(*) AS pedidos
           FROM pedidos p LEFT JOIN ubigeos ub ON ub.codigo = p.ubigeo
           WHERE ${RANGO} AND ${VALIDO} GROUP BY 1 ORDER BY pedidos DESC LIMIT 10`,
          r
        ),
      ]);
    return { desde, hasta, resumen, hoy: hoyResumen, porEstado, porDia, porPlataforma, porVendedor, porTipo, topProductos, topDistritos };
  },
};
