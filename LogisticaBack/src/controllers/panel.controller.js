import { query } from '../config/db.js';

const dias = (q) => Math.min(Math.max(Number(q.dias) || 30, 1), 365);

/** Dashboards de los módulos Productos y Precios. */
export const PanelController = {
  async productos(req, res) {
    const n = dias(req.query);
    const [resumen, porTipo, porSourcing, porVerificacion, porCategoria, porMarca, masVendidos, recientes] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE activo)::int AS activos,
                    COUNT(*) FILTER (WHERE activo AND subcategoria_id IS NULL)::int AS sin_categoria,
                    COUNT(*) FILTER (WHERE activo AND tipo = 'Combo')::int AS combos,
                    COUNT(*) FILTER (WHERE activo AND COALESCE(precio, 0) = 0)::int AS sin_precio,
                    COUNT(*) FILTER (WHERE activo AND tipo NOT IN ('Combo', 'Servicio')
                                     AND (peso_kg IS NULL OR largo_cm IS NULL OR ancho_cm IS NULL OR alto_cm IS NULL))::int AS sin_medidas,
                    COUNT(*) FILTER (WHERE creado_en > now() - make_interval(days => $1))::int AS nuevos
             FROM productos`, [n]),
      query(`SELECT tipo AS nombre, COUNT(*)::int AS cantidad FROM productos WHERE activo GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT COALESCE(estado_sourcing, 'Sin estado') AS nombre, COUNT(*)::int AS cantidad FROM productos WHERE activo GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT COALESCE(estado_verificacion, 'Sin estado') AS nombre, COUNT(*)::int AS cantidad FROM productos WHERE activo GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT c.nombre, COUNT(*)::int AS cantidad
             FROM productos p JOIN subcategorias s ON s.id = p.subcategoria_id JOIN categorias c ON c.id = s.categoria_id
             WHERE p.activo GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
      query(`SELECT COALESCE(m.nombre, 'Sin marca') AS nombre, COALESCE(m.propia, false) AS propia, COUNT(*)::int AS cantidad
             FROM productos p LEFT JOIN marcas m ON m.id = p.marca_id WHERE p.activo GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`),
      query(`SELECT i.sku, MAX(i.descripcion) AS nombre, SUM(i.cantidad)::int AS unidades, SUM(i.subtotal) AS monto
             FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
             WHERE p.categoria = 'venta' AND p.estado <> 'cancelado' AND p.fecha_entrega > (now() AT TIME ZONE 'America/Lima')::date - $1::int
             GROUP BY i.sku ORDER BY unidades DESC, monto DESC LIMIT 10`, [n]),
      query(`SELECT id, sku, descripcion, tipo, creado_en FROM productos ORDER BY creado_en DESC, id DESC LIMIT 8`),
    ]);
    res.json({
      dias: n, resumen: resumen.rows[0], porTipo: porTipo.rows, porSourcing: porSourcing.rows, porVerificacion: porVerificacion.rows,
      porCategoria: porCategoria.rows, porMarca: porMarca.rows, masVendidos: masVendidos.rows, recientes: recientes.rows,
    });
  },

  async precios(req, res) {
    const n = dias(req.query);
    const [cobertura, porDia, ultimos, alertas] = await Promise.all([
      // precio vigente por plataforma: cobertura del catálogo activo y descuento promedio
      query(`WITH vig AS (
               SELECT DISTINCT ON (pr.producto_id, pr.plataforma_id) pr.producto_id, pr.plataforma_id, pr.precio,
                      COALESCE(pr.precio_normal, p.precio_normal) AS normal
               FROM precios pr JOIN productos p ON p.id = pr.producto_id WHERE p.activo
               ORDER BY pr.producto_id, pr.plataforma_id, pr.fecha DESC
             )
             SELECT pl.nombre, COUNT(v.producto_id)::int AS skus,
                    ROUND(COUNT(v.producto_id)::numeric / NULLIF((SELECT COUNT(*) FROM productos WHERE activo), 0) * 100, 1)::float AS cobertura,
                    ROUND(AVG(CASE WHEN v.normal > 0 THEN (1 - v.precio / v.normal) * 100 END), 1)::float AS descuento
             FROM plataformas_precio pl LEFT JOIN vig v ON v.plataforma_id = pl.id
             WHERE pl.activo GROUP BY pl.id ORDER BY pl.orden`),
      query(`SELECT fecha::text AS dia, COUNT(*)::int AS cambios, COUNT(DISTINCT producto_id)::int AS skus
             FROM precios WHERE fecha > (now() AT TIME ZONE 'America/Lima')::date - $1::int GROUP BY 1 ORDER BY 1`, [n]),
      query(`WITH x AS (
               SELECT pr.*, LAG(pr.precio) OVER (PARTITION BY pr.producto_id, pr.plataforma_id ORDER BY pr.fecha) AS anterior
               FROM precios pr
             )
             SELECT x.fecha, p.id AS producto_id, p.sku, p.descripcion, pl.nombre AS plataforma, x.precio, x.anterior
             FROM x JOIN productos p ON p.id = x.producto_id JOIN plataformas_precio pl ON pl.id = x.plataforma_id
             WHERE x.anterior IS DISTINCT FROM x.precio
             ORDER BY x.fecha DESC, x.id DESC LIMIT 15`),
      query(`WITH web AS (
               SELECT DISTINCT ON (pr.producto_id) pr.producto_id, pr.fecha
               FROM precios pr JOIN plataformas_precio pl ON pl.id = pr.plataforma_id AND pl.nombre = 'Web'
               ORDER BY pr.producto_id, pr.fecha DESC
             )
             SELECT COUNT(*) FILTER (WHERE w.producto_id IS NULL)::int AS sin_precio_web,
                    COUNT(*) FILTER (WHERE w.fecha < (now() AT TIME ZONE 'America/Lima')::date - 180)::int AS precio_antiguo,
                    COUNT(*)::int AS activos
             FROM productos p LEFT JOIN web w ON w.producto_id = p.id WHERE p.activo AND p.tipo <> 'Servicio'`),
    ]);
    const cambiosPeriodo = porDia.rows.reduce((s, d) => s + d.cambios, 0);
    res.json({ dias: n, cobertura: cobertura.rows, porDia: porDia.rows, ultimos: ultimos.rows, alertas: { ...alertas.rows[0], cambios_periodo: cambiosPeriodo } });
  },
};
