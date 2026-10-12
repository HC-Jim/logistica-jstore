import { query } from '../config/db.js';

// Reportes de los módulos Productos y Precios (mismo formato que reporte.controller.js)
const col = (clave, titulo, tipo = 'texto') => ({ clave, titulo, tipo });

const PROBLEMAS = ['Sin categoría nueva', 'Sin marca', 'Sin medidas', 'Sin precio Web', 'Sin precio normal', 'Sin verificar'];

export const REPORTES_PRODUCTOS = {
  catalogo: {
    titulo: 'Calidad del catálogo',
    descripcion: 'SKU activos con datos por completar: categoría, marca, medidas, precios o verificación física.',
    sinFechas: true,
    filtros: [{ clave: 'problema', etiqueta: 'Problema', opciones: PROBLEMAS }],
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT p.id, p.sku, p.descripcion, p.tipo, c.nombre AS categoria, m.nombre AS marca, p.estado_sourcing, p.estado_verificacion,
                p.peso_kg, p.largo_cm, p.ancho_cm, p.alto_cm, p.precio, p.precio_normal,
                array_remove(ARRAY[
                  CASE WHEN p.subcategoria_id IS NULL THEN 'Sin categoría nueva' END,
                  CASE WHEN p.marca_id IS NULL THEN 'Sin marca' END,
                  CASE WHEN p.tipo NOT IN ('Combo', 'Servicio') AND (p.peso_kg IS NULL OR p.largo_cm IS NULL OR p.ancho_cm IS NULL OR p.alto_cm IS NULL) THEN 'Sin medidas' END,
                  CASE WHEN COALESCE(p.precio, 0) = 0 THEN 'Sin precio Web' END,
                  CASE WHEN p.precio_normal IS NULL THEN 'Sin precio normal' END,
                  CASE WHEN p.tipo NOT IN ('Combo', 'Servicio') AND p.estado_verificacion IS DISTINCT FROM 'Medido y Verificado' THEN 'Sin verificar' END
                ], NULL) AS problemas
         FROM productos p
         LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
         LEFT JOIN categorias c ON c.id = s.categoria_id
         LEFT JOIN marcas m ON m.id = p.marca_id
         WHERE p.activo
         ORDER BY p.descripcion`
      );
      const conProblema = rows.filter((r) => r.problemas.length && (!f.problema || r.problemas.includes(f.problema)));
      return {
        columnas: [
          col('sku', 'SKU'), col('descripcion', 'Nombre'), col('tipo', 'Tipo'), col('categoria', 'Categoría'), col('marca', 'Marca'),
          col('problemas_txt', 'Por completar'), col('estado_sourcing', 'Sourcing'), col('estado_verificacion', 'Verificación'),
          col('precio', 'Web', 'monto'), col('precio_normal', 'P. Normal', 'monto'),
        ],
        filas: conProblema.map((r) => ({ ...r, problemas_txt: r.problemas.join(' · ') })),
        resumen: [
          { etiqueta: 'SKU activos', valor: rows.length },
          { etiqueta: 'Completos', valor: rows.filter((r) => !r.problemas.length).length },
          ...PROBLEMAS.map((p) => ({ etiqueta: p, valor: rows.filter((r) => r.problemas.includes(p)).length, alerta: rows.some((r) => r.problemas.includes(p)) })),
        ],
      };
    },
  },

  combos: {
    titulo: 'Combos',
    descripcion: 'Componentes de cada combo y si la suma de sus partes coincide con el precio Web del combo.',
    sinFechas: true,
    filtros: [{ clave: 'solo_diferencias', etiqueta: 'Solo combos con diferencia', check: true }],
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT p.id, p.sku, p.descripcion, p.precio, p.activo,
                COUNT(cc.componente_id)::int AS componentes,
                string_agg(k.sku || ' ' || k.descripcion || ' x' || cc.cantidad, ' | ' ORDER BY k.descripcion) AS detalle,
                SUM(cc.precio * cc.cantidad) AS suma_partes,
                SUM(k.precio * cc.cantidad) AS suma_web_componentes
         FROM productos p
         LEFT JOIN combo_componentes cc ON cc.combo_id = p.id
         LEFT JOIN productos k ON k.id = cc.componente_id
         WHERE p.tipo = 'Combo'
         GROUP BY p.id ORDER BY p.descripcion`
      );
      const filas = rows.map((r) => ({
        ...r,
        diferencia: r.suma_partes != null ? Math.round((Number(r.precio) - Number(r.suma_partes)) * 100) / 100 : null,
        ahorro: r.suma_web_componentes > 0 ? Math.round((1 - Number(r.precio) / Number(r.suma_web_componentes)) * 1000) / 10 : null,
      })).filter((r) => f.solo_diferencias !== '1' || !r.componentes || Math.abs(r.diferencia ?? 0) > 0.009);
      return {
        columnas: [
          col('sku', 'SKU combo'), col('descripcion', 'Combo'), col('componentes', 'Componentes', 'entero'), col('detalle', 'Detalle'),
          col('precio', 'Web del combo', 'monto'), col('suma_partes', 'Suma de partes', 'monto'), col('diferencia', 'Diferencia', 'monto'),
          col('suma_web_componentes', 'Comprados por separado', 'monto'), col('ahorro', 'Ahorro para el cliente', 'pct'),
        ],
        filas,
        resumen: [
          { etiqueta: 'Combos', valor: rows.length },
          { etiqueta: 'Sin componentes', valor: rows.filter((r) => !r.componentes).length, alerta: rows.some((r) => !r.componentes) },
          { etiqueta: 'Suma ≠ precio Web', valor: filas.filter((r) => r.componentes && Math.abs(r.diferencia ?? 0) > 0.009).length },
        ],
      };
    },
  },
};

export const REPORTES_PRECIOS = {
  cambios_precio: {
    titulo: 'Cambios de precio',
    descripcion: 'Cada precio registrado en el periodo con el precio anterior de esa plataforma y su variación.',
    filtros: [{ clave: 'plataforma', etiqueta: 'Plataforma', opcionesDe: 'plataformas' }],
    async ejecutar(f) {
      const { rows } = await query(
        `WITH x AS (
           SELECT pr.*, LAG(pr.precio) OVER (PARTITION BY pr.producto_id, pr.plataforma_id ORDER BY pr.fecha) AS anterior
           FROM precios pr
         )
         SELECT x.fecha, p.sku, p.descripcion, pl.nombre AS plataforma, x.precio, x.anterior,
                CASE WHEN x.anterior > 0 THEN ROUND((x.precio / x.anterior - 1) * 100, 1) END AS variacion,
                x.precio_normal,
                CASE WHEN x.precio_normal > 0 THEN ROUND((1 - x.precio / x.precio_normal) * 100, 1) END AS descuento,
                u.nombre AS registrado_por
         FROM x JOIN productos p ON p.id = x.producto_id JOIN plataformas_precio pl ON pl.id = x.plataforma_id
         LEFT JOIN usuarios u ON u.id = x.creado_por
         WHERE x.fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR pl.nombre = $3)
           AND (x.anterior IS NULL OR x.anterior <> x.precio)
         ORDER BY x.fecha DESC, p.descripcion, pl.orden`,
        [f.desde, f.hasta, f.plataforma]
      );
      return {
        columnas: [
          col('fecha', 'Fecha', 'fecha'), col('sku', 'SKU'), col('descripcion', 'Producto'), col('plataforma', 'Plataforma'),
          col('anterior', 'Precio anterior', 'monto'), col('precio', 'Precio nuevo', 'monto'), col('variacion', 'Variación', 'pct'),
          col('precio_normal', 'P. Normal', 'monto'), col('descuento', 'Descuento', 'pct'), col('registrado_por', 'Registrado por'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Cambios', valor: rows.length },
          { etiqueta: 'SKU distintos', valor: new Set(rows.map((r) => r.sku)).size },
          { etiqueta: 'Subidas', valor: rows.filter((r) => r.variacion > 0).length },
          { etiqueta: 'Bajadas', valor: rows.filter((r) => r.variacion < 0).length },
        ],
      };
    },
  },

  descuento_plataforma: {
    titulo: 'Descuento por plataforma',
    descripcion: 'Precio vigente al cierre del periodo en cada plataforma: cobertura de SKU y descuento frente al precio normal.',
    async ejecutar(f) {
      const { rows } = await query(
        `WITH vig AS (
           SELECT DISTINCT ON (pr.producto_id, pr.plataforma_id) pr.producto_id, pr.plataforma_id, pr.precio,
                  COALESCE(pr.precio_normal, p.precio_normal) AS normal
           FROM precios pr JOIN productos p ON p.id = pr.producto_id
           WHERE pr.fecha <= $2 AND p.activo
           ORDER BY pr.producto_id, pr.plataforma_id, pr.fecha DESC
         ), cambios AS (
           SELECT plataforma_id, COUNT(*)::int AS cambios FROM precios WHERE fecha BETWEEN $1 AND $2 GROUP BY 1
         )
         SELECT pl.nombre AS plataforma, pl.activo, COUNT(v.producto_id)::int AS skus,
                ROUND(COUNT(v.producto_id)::numeric / NULLIF((SELECT COUNT(*) FROM productos WHERE activo), 0) * 100, 1) AS cobertura,
                ROUND(AVG(CASE WHEN v.normal > 0 THEN (1 - v.precio / v.normal) * 100 END), 1) AS desc_prom,
                ROUND(MAX(CASE WHEN v.normal > 0 THEN (1 - v.precio / v.normal) * 100 END), 1) AS desc_max,
                ROUND(AVG(v.precio), 2) AS precio_prom, COALESCE(c.cambios, 0) AS cambios
         FROM plataformas_precio pl
         LEFT JOIN vig v ON v.plataforma_id = pl.id
         LEFT JOIN cambios c ON c.plataforma_id = pl.id
         GROUP BY pl.id, c.cambios ORDER BY pl.orden`,
        [f.desde, f.hasta]
      );
      return {
        columnas: [
          col('plataforma', 'Plataforma'), col('skus', 'SKU con precio', 'entero'), col('cobertura', 'Cobertura del catálogo', 'pct'),
          col('desc_prom', 'Descuento promedio', 'pct'), col('desc_max', 'Descuento máximo', 'pct'), col('precio_prom', 'Precio promedio', 'monto'),
          col('cambios', 'Cambios en el periodo', 'entero'),
        ],
        filas: rows.map((r) => ({ ...r, plataforma: r.activo ? r.plataforma : `${r.plataforma} (solo historial)` })),
        resumen: [{ etiqueta: 'Plataformas', valor: rows.filter((r) => r.activo).length }],
      };
    },
  },
};
