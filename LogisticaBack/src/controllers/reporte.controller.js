import { CATEGORIAS, ESTADOS_PEDIDO, ESTADOS_RUTA, PLATAFORMAS } from '../config/catalogos.js';
import { query } from '../config/db.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError } from '../utils/http.js';

/*
 * Reportes: cada uno devuelve { columnas, filas, resumen } y la web los muestra en una tabla
 * que se puede exportar a Excel (CSV). Tipos de columna: texto, entero, monto, km, pct,
 * fecha, fechahora, duracion (segundos), pedido (id con enlace), url.
 */

const col = (clave, titulo, tipo = 'texto') => ({ clave, titulo, tipo });

/** Kilómetros reales recorridos por ruta según el GPS del conductor (o del auxiliar si no hay del conductor). */
const CTE_GPS = `
  pos AS (
    SELECT x.ruta_id, x.lat::float AS lat, x.lng::float AS lng, x.velocidad, x.registrado_en,
           LAG(x.lat::float) OVER w AS plat, LAG(x.lng::float) OVER w AS plng, LAG(x.registrado_en) OVER w AS pt
    FROM posiciones x JOIN rutas r ON r.id = x.ruta_id
    WHERE r.fecha BETWEEN $1 AND $2 AND x.usuario_id = COALESCE(r.repartidor_id, r.asistente_id)
    WINDOW w AS (PARTITION BY x.ruta_id ORDER BY x.registrado_en)
  ),
  tramos AS (
    SELECT ruta_id, velocidad, registrado_en,
           CASE WHEN plat IS NULL THEN 0
                ELSE 111320 * sqrt(power(lat - plat, 2) + power((lng - plng) * cos(radians(lat)), 2)) END AS m,
           EXTRACT(EPOCH FROM registrado_en - pt) AS s
    FROM pos
  ),
  gps AS (
    SELECT ruta_id, COUNT(*)::int AS puntos, MIN(registrado_en) AS inicio, MAX(registrado_en) AS fin,
           -- se descartan saltos imposibles del GPS (más de 150 km/h entre dos lecturas)
           ROUND((SUM(m) FILTER (WHERE s IS NULL OR m / NULLIF(s, 0) < 42) / 1000)::numeric, 2) AS km,
           ROUND((MAX(velocidad) * 3.6)::numeric, 0) AS vmax
    FROM tramos GROUP BY ruta_id
  )`;

const REPORTES = {
  pedidos: {
    titulo: 'Pedidos',
    descripcion: 'Todos los registros del periodo con productos, cobro, estado y ruta.',
    filtros: [
      { clave: 'categoria', etiqueta: 'Categoría', opciones: CATEGORIAS },
      { clave: 'estado', etiqueta: 'Estado', opciones: ESTADOS_PEDIDO },
      { clave: 'plataforma', etiqueta: 'Plataforma', opciones: PLATAFORMAS },
    ],
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT p.id, p.fecha_entrega, p.categoria, p.plataforma, p.tipo_pedido, p.numero_pedido, p.documento_bsale,
                p.cliente_nombre, p.cliente_telefono, ub.distrito, p.agencia,
                (SELECT string_agg(i.descripcion || ' x' || i.cantidad, ' | ' ORDER BY i.id) FROM pedido_items i WHERE i.pedido_id = p.id) AS productos,
                p.total_pedido, p.cobrar, p.medio_pago, v.nombre AS vendedor, p.estado,
                r.numero AS ruta, rp.completada_en AS atendido_en
         FROM pedidos p
         JOIN usuarios v ON v.id = p.vendedor_id
         LEFT JOIN ubigeos ub ON ub.codigo = p.ubigeo
         LEFT JOIN LATERAL (SELECT x.ruta_id, x.completada_en FROM ruta_paradas x WHERE x.pedido_id = p.id ORDER BY x.id DESC LIMIT 1) rp ON true
         LEFT JOIN rutas r ON r.id = rp.ruta_id
         WHERE p.fecha_entrega BETWEEN $1 AND $2
           AND ($3::text IS NULL OR p.categoria = $3) AND ($4::text IS NULL OR p.estado = $4) AND ($5::text IS NULL OR p.plataforma = $5)
         ORDER BY p.fecha_entrega, p.id`,
        [f.desde, f.hasta, f.categoria, f.estado, f.plataforma]
      );
      const porEstado = Object.fromEntries(ESTADOS_PEDIDO.map((e) => [e, rows.filter((r) => r.estado === e).length]));
      return {
        columnas: [
          col('id', 'Código', 'pedido'), col('fecha_entrega', 'Entrega', 'fecha'), col('categoria', 'Categoría'),
          col('plataforma', 'Plataforma'), col('tipo_pedido', 'Tipo'), col('numero_pedido', '# Pedido'),
          col('documento_bsale', 'Doc. Bsale'), col('cliente_nombre', 'Cliente'), col('cliente_telefono', 'Teléfono'),
          col('distrito', 'Distrito'), col('agencia', 'Agencia'), col('productos', 'Productos'), col('total_pedido', 'Total', 'monto'),
          col('cobrar', 'Cobrar'), col('medio_pago', 'Medio de pago'), col('vendedor', 'Vendedor'), col('estado', 'Estado'),
          col('ruta', 'Ruta', 'entero'), col('atendido_en', 'Atendido', 'fechahora'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Registros', valor: rows.length },
          { etiqueta: 'Monto (sin cancelados)', valor: rows.filter((r) => r.estado !== 'cancelado').reduce((s, r) => s + Number(r.total_pedido), 0), tipo: 'monto' },
          ...Object.entries(porEstado).map(([e, n]) => ({ etiqueta: e, valor: n })),
        ],
      };
    },
  },

  bsale: {
    titulo: 'Documentos Bsale por pedido',
    descripcion: 'Número de documento Bsale de cada venta; sirve para ubicar ventas sin documento.',
    filtros: [{ clave: 'sin_documento', etiqueta: 'Solo ventas sin documento', check: true }],
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT p.id, p.fecha_entrega, p.plataforma, p.numero_pedido, p.documento_bsale, p.cliente_nombre,
                p.total_pedido, p.cobrar, p.estado, v.nombre AS vendedor
         FROM pedidos p JOIN usuarios v ON v.id = p.vendedor_id
         WHERE p.categoria = 'venta' AND p.fecha_entrega BETWEEN $1 AND $2
           AND (NOT $3 OR NULLIF(trim(p.documento_bsale), '') IS NULL)
         ORDER BY p.fecha_entrega, p.id`,
        [f.desde, f.hasta, f.sin_documento === '1']
      );
      const sin = rows.filter((r) => !r.documento_bsale).length;
      return {
        columnas: [
          col('id', 'Código', 'pedido'), col('fecha_entrega', 'Entrega', 'fecha'), col('plataforma', 'Plataforma'),
          col('numero_pedido', '# Pedido'), col('documento_bsale', 'Doc. Bsale'), col('cliente_nombre', 'Cliente'),
          col('total_pedido', 'Total', 'monto'), col('cobrar', 'Cobrar'), col('estado', 'Estado'), col('vendedor', 'Vendedor'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Ventas', valor: rows.length },
          { etiqueta: 'Con documento', valor: rows.length - sin },
          { etiqueta: 'Sin documento', valor: sin, alerta: sin > 0 },
        ],
      };
    },
  },

  productos: {
    titulo: 'Productos',
    descripcion: 'Unidades y montos vendidos por producto (ventas no canceladas).',
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT i.sku, MAX(i.descripcion) AS descripcion, SUM(i.cantidad)::int AS unidades,
                SUM(i.cantidad) FILTER (WHERE p.estado = 'entregado')::int AS entregadas,
                COUNT(DISTINCT p.id)::int AS pedidos, SUM(i.subtotal) AS monto, ROUND(AVG(i.precio_unitario), 2) AS precio_prom
         FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
         WHERE p.categoria = 'venta' AND p.estado <> 'cancelado' AND p.fecha_entrega BETWEEN $1 AND $2
         GROUP BY i.sku ORDER BY unidades DESC, monto DESC`,
        [f.desde, f.hasta]
      );
      return {
        columnas: [
          col('sku', 'SKU'), col('descripcion', 'Descripción'), col('unidades', 'Unidades', 'entero'),
          col('entregadas', 'Entregadas', 'entero'), col('pedidos', 'Pedidos', 'entero'),
          col('precio_prom', 'Precio prom.', 'monto'), col('monto', 'Monto', 'monto'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Productos distintos', valor: rows.length },
          { etiqueta: 'Unidades', valor: rows.reduce((s, r) => s + r.unidades, 0) },
          { etiqueta: 'Monto', valor: rows.reduce((s, r) => s + Number(r.monto), 0), tipo: 'monto' },
        ],
      };
    },
  },

  variacion_precio: {
    titulo: 'Variación de precio',
    descripcion: 'Precio al que se vendió cada producto frente al precio del catálogo.',
    filtros: [{ clave: 'solo_variacion', etiqueta: 'Solo productos con variación', check: true }],
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT * FROM (
           SELECT i.sku, MAX(i.descripcion) AS descripcion, MAX(pr.precio) AS catalogo,
                  COUNT(*)::int AS lineas, SUM(i.cantidad)::int AS unidades,
                  MIN(i.precio_unitario) AS minimo, MAX(i.precio_unitario) AS maximo, ROUND(AVG(i.precio_unitario), 2) AS promedio,
                  ROUND((MAX(i.precio_unitario) - MIN(i.precio_unitario)) / NULLIF(MIN(i.precio_unitario), 0) * 100, 1) AS variacion,
                  ROUND((AVG(i.precio_unitario) - MAX(pr.precio)) / NULLIF(MAX(pr.precio), 0) * 100, 1) AS vs_catalogo,
                  COUNT(*) FILTER (WHERE i.precio_unitario < pr.precio)::int AS bajo_catalogo
           FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id LEFT JOIN productos pr ON pr.id = i.producto_id
           WHERE p.categoria = 'venta' AND p.estado <> 'cancelado' AND i.producto_id IS NOT NULL
             AND p.fecha_entrega BETWEEN $1 AND $2
           GROUP BY i.sku
         ) x
         WHERE NOT $3 OR x.minimo <> x.maximo OR x.promedio <> x.catalogo
         ORDER BY abs(COALESCE(x.vs_catalogo, 0)) + COALESCE(x.variacion, 0) DESC, x.sku`,
        [f.desde, f.hasta, f.solo_variacion === '1']
      );
      return {
        columnas: [
          col('sku', 'SKU'), col('descripcion', 'Descripción'), col('catalogo', 'Precio catálogo', 'monto'),
          col('minimo', 'Mínimo vendido', 'monto'), col('maximo', 'Máximo vendido', 'monto'), col('promedio', 'Promedio', 'monto'),
          col('variacion', 'Variación mín-máx', 'pct'), col('vs_catalogo', 'Promedio vs catálogo', 'pct'),
          col('bajo_catalogo', 'Ventas bajo catálogo', 'entero'), col('lineas', 'Ventas', 'entero'), col('unidades', 'Unidades', 'entero'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Productos', valor: rows.length },
          { etiqueta: 'Con ventas bajo catálogo', valor: rows.filter((r) => r.bajo_catalogo > 0).length, alerta: rows.some((r) => r.bajo_catalogo > 0) },
        ],
      };
    },
  },

  rutas: {
    titulo: 'Rutas',
    descripcion: 'Resultado de cada ruta: paradas, entregas, incidencias, kilómetros y horarios.',
    filtros: [{ clave: 'estado', etiqueta: 'Estado', opciones: ESTADOS_RUTA }],
    async ejecutar(f) {
      const { rows } = await query(
        `WITH ${CTE_GPS}
         SELECT r.id, r.fecha, r.numero, r.estado, v.nombre AS vehiculo, c.nombre AS conductor, a.nombre AS auxiliar,
                k.total, k.entregadas, k.incidencias, k.canceladas, k.pendientes,
                ROUND(k.entregadas::numeric / NULLIF(k.total - k.canceladas, 0) * 100, 1) AS efectividad,
                ROUND(r.distancia_metros / 1000.0, 2) AS km_plan, g.km AS km_gps,
                k.primera, k.ultima, r.finalizada_en
         FROM rutas r
         LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
         LEFT JOIN usuarios c ON c.id = r.repartidor_id
         LEFT JOIN usuarios a ON a.id = r.asistente_id
         LEFT JOIN gps g ON g.ruta_id = r.id
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE x.estado = 'completada')::int AS entregadas,
                  COUNT(*) FILTER (WHERE x.estado = 'incidencia')::int AS incidencias,
                  COUNT(*) FILTER (WHERE x.estado = 'cancelada')::int AS canceladas,
                  COUNT(*) FILTER (WHERE x.estado = 'pendiente')::int AS pendientes,
                  MIN(x.completada_en) FILTER (WHERE x.estado IN ('completada', 'incidencia')) AS primera,
                  MAX(x.completada_en) FILTER (WHERE x.estado IN ('completada', 'incidencia')) AS ultima
           FROM ruta_paradas x WHERE x.ruta_id = r.id
         ) k
         WHERE r.fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR r.estado = $3)
         ORDER BY r.fecha, r.numero`,
        [f.desde, f.hasta, f.estado]
      );
      const suma = (c) => rows.reduce((s, r) => s + Number(r[c] ?? 0), 0);
      return {
        columnas: [
          col('fecha', 'Fecha', 'fecha'), col('numero', 'Ruta', 'entero'), col('estado', 'Estado'), col('vehiculo', 'Vehículo'),
          col('conductor', 'Conductor'), col('auxiliar', 'Auxiliar'), col('total', 'Paradas', 'entero'),
          col('entregadas', 'Entregadas', 'entero'), col('incidencias', 'Incidencias', 'entero'), col('canceladas', 'Canceladas', 'entero'),
          col('pendientes', 'Pendientes', 'entero'), col('efectividad', 'Efectividad', 'pct'), col('km_plan', 'Km plan.', 'km'),
          col('km_gps', 'Km GPS', 'km'), col('primera', 'Primera atención', 'fechahora'), col('ultima', 'Última atención', 'fechahora'),
          col('finalizada_en', 'Regreso / fin', 'fechahora'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Rutas', valor: rows.length },
          { etiqueta: 'Paradas', valor: suma('total') },
          { etiqueta: 'Entregadas', valor: suma('entregadas') },
          { etiqueta: 'Incidencias', valor: suma('incidencias') },
          { etiqueta: 'Efectividad', valor: suma('total') - suma('canceladas') ? Math.round((suma('entregadas') / (suma('total') - suma('canceladas'))) * 1000) / 10 : null, tipo: 'pct' },
          { etiqueta: 'Km GPS', valor: Math.round(suma('km_gps') * 10) / 10, tipo: 'km' },
        ],
      };
    },
  },

  recorrido: {
    titulo: 'Recorrido de ruta (GPS)',
    descripcion: 'Kilómetros y horarios reales según el GPS frente a lo planificado. El GPS se guarda 30 días.',
    async ejecutar(f) {
      const { rows } = await query(
        `WITH ${CTE_GPS}
         SELECT r.id, r.fecha, r.numero, c.nombre AS conductor, v.nombre AS vehiculo,
                g.puntos, g.inicio, g.fin, EXTRACT(EPOCH FROM g.fin - g.inicio)::int AS duracion,
                ROUND(r.distancia_metros / 1000.0, 2) AS km_plan, g.km AS km_gps,
                ROUND((g.km / NULLIF(r.distancia_metros / 1000.0, 0) - 1) * 100, 1) AS desvio,
                ROUND(g.km / NULLIF(EXTRACT(EPOCH FROM g.fin - g.inicio) / 3600, 0), 1) AS vprom, g.vmax
         FROM rutas r
         JOIN gps g ON g.ruta_id = r.id
         LEFT JOIN usuarios c ON c.id = r.repartidor_id
         LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
         WHERE r.fecha BETWEEN $1 AND $2
         ORDER BY r.fecha, r.numero`,
        [f.desde, f.hasta]
      );
      return {
        columnas: [
          col('fecha', 'Fecha', 'fecha'), col('numero', 'Ruta', 'entero'), col('conductor', 'Conductor'), col('vehiculo', 'Vehículo'),
          col('inicio', 'Inicio GPS', 'fechahora'), col('fin', 'Fin GPS', 'fechahora'), col('duracion', 'Duración', 'duracion'),
          col('km_plan', 'Km plan.', 'km'), col('km_gps', 'Km recorridos', 'km'), col('desvio', 'Diferencia vs plan', 'pct'),
          col('vprom', 'Vel. prom. (km/h)', 'entero'), col('vmax', 'Vel. máx. (km/h)', 'entero'), col('puntos', 'Lecturas GPS', 'entero'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Rutas con GPS', valor: rows.length },
          { etiqueta: 'Km recorridos', valor: Math.round(rows.reduce((s, r) => s + Number(r.km_gps ?? 0), 0) * 10) / 10, tipo: 'km' },
        ],
      };
    },
  },

  flota: {
    titulo: 'Flota',
    descripcion: 'Uso de cada vehículo: rutas, días, paradas y kilómetros.',
    async ejecutar(f) {
      const { rows } = await query(
        `WITH ${CTE_GPS}
         SELECT v.id, v.nombre AS vehiculo, v.tipo, v.placa, v.activo,
                COUNT(r.id)::int AS rutas, COUNT(DISTINCT r.fecha)::int AS dias,
                COALESCE(SUM(k.total), 0)::int AS paradas, COALESCE(SUM(k.entregadas), 0)::int AS entregadas,
                COALESCE(SUM(k.incidencias), 0)::int AS incidencias,
                ROUND(COALESCE(SUM(r.distancia_metros), 0) / 1000.0, 1) AS km_plan, ROUND(COALESCE(SUM(g.km), 0), 1) AS km_gps,
                string_agg(DISTINCT c.nombre, ', ') AS conductores
         FROM vehiculos v
         LEFT JOIN rutas r ON r.vehiculo_id = v.id AND r.fecha BETWEEN $1 AND $2
         LEFT JOIN gps g ON g.ruta_id = r.id
         LEFT JOIN usuarios c ON c.id = r.repartidor_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE x.estado = 'completada') AS entregadas,
                  COUNT(*) FILTER (WHERE x.estado = 'incidencia') AS incidencias
           FROM ruta_paradas x WHERE x.ruta_id = r.id
         ) k ON true
         GROUP BY v.id ORDER BY rutas DESC, v.nombre`,
        [f.desde, f.hasta]
      );
      return {
        columnas: [
          col('vehiculo', 'Vehículo'), col('tipo', 'Tipo'), col('placa', 'Placa'), col('rutas', 'Rutas', 'entero'),
          col('dias', 'Días usado', 'entero'), col('paradas', 'Paradas', 'entero'), col('entregadas', 'Entregadas', 'entero'),
          col('incidencias', 'Incidencias', 'entero'), col('km_plan', 'Km plan.', 'km'), col('km_gps', 'Km GPS', 'km'),
          col('conductores', 'Conductores'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Vehículos', valor: rows.length },
          { etiqueta: 'Sin uso en el periodo', valor: rows.filter((r) => !r.rutas).length },
        ],
      };
    },
  },

  incidencias: {
    titulo: 'Incidencias',
    descripcion: 'Entregas que no se pudieron completar, con el motivo que registró el conductor.',
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT x.completada_en, r.fecha, r.numero AS ruta, c.nombre AS conductor, p.id AS pedido_id,
                COALESCE(x.descripcion, p.cliente_nombre) AS cliente, ub.distrito, p.tipo_pedido, p.plataforma,
                x.nota AS motivo, v.nombre AS vendedor, p.estado AS estado_actual
         FROM ruta_paradas x
         JOIN rutas r ON r.id = x.ruta_id
         LEFT JOIN pedidos p ON p.id = x.pedido_id
         LEFT JOIN ubigeos ub ON ub.codigo = p.ubigeo
         LEFT JOIN usuarios c ON c.id = r.repartidor_id
         LEFT JOIN usuarios v ON v.id = p.vendedor_id
         WHERE x.estado = 'incidencia' AND r.fecha BETWEEN $1 AND $2
         ORDER BY x.completada_en`,
        [f.desde, f.hasta]
      );
      const motivos = {};
      for (const r of rows) motivos[r.motivo || 'Sin motivo'] = (motivos[r.motivo || 'Sin motivo'] ?? 0) + 1;
      return {
        columnas: [
          col('completada_en', 'Fecha y hora', 'fechahora'), col('ruta', 'Ruta', 'entero'), col('conductor', 'Conductor'),
          col('pedido_id', 'Pedido', 'pedido'), col('cliente', 'Cliente'), col('distrito', 'Distrito'), col('tipo_pedido', 'Tipo'),
          col('plataforma', 'Plataforma'), col('motivo', 'Motivo'), col('vendedor', 'Vendedor'), col('estado_actual', 'Estado actual'),
        ],
        filas: rows,
        resumen: [
          { etiqueta: 'Incidencias', valor: rows.length },
          ...Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m, n]) => ({ etiqueta: m, valor: n })),
        ],
      };
    },
  },

  inversa: {
    titulo: 'Logística inversa',
    descripcion: 'Recojos y entregas de servicio técnico, piezas y cambios.',
    filtros: [{ clave: 'estado', etiqueta: 'Estado', opciones: ESTADOS_PEDIDO }],
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT p.id, p.fecha_entrega, p.tipo_pedido, p.motivo, p.pedido_relacionado, p.cliente_nombre, p.cliente_telefono,
                ub.distrito, (SELECT string_agg(i.descripcion || ' x' || i.cantidad, ' | ' ORDER BY i.id) FROM pedido_items i WHERE i.pedido_id = p.id) AS piezas,
                p.estado, r.numero AS ruta, rp.completada_en AS atendido_en, rp.nota, v.nombre AS registrado_por
         FROM pedidos p
         JOIN usuarios v ON v.id = p.vendedor_id
         LEFT JOIN ubigeos ub ON ub.codigo = p.ubigeo
         LEFT JOIN LATERAL (SELECT x.ruta_id, x.completada_en, x.nota FROM ruta_paradas x WHERE x.pedido_id = p.id ORDER BY x.id DESC LIMIT 1) rp ON true
         LEFT JOIN rutas r ON r.id = rp.ruta_id
         WHERE p.categoria = 'inversa' AND p.fecha_entrega BETWEEN $1 AND $2 AND ($3::text IS NULL OR p.estado = $3)
         ORDER BY p.fecha_entrega, p.id`,
        [f.desde, f.hasta, f.estado]
      );
      const porTipo = {};
      for (const r of rows) porTipo[r.tipo_pedido] = (porTipo[r.tipo_pedido] ?? 0) + 1;
      return {
        columnas: [
          col('id', 'Código', 'pedido'), col('fecha_entrega', 'Fecha', 'fecha'), col('tipo_pedido', 'Tipo'), col('motivo', 'Motivo'),
          col('pedido_relacionado', 'Pedido original'), col('cliente_nombre', 'Cliente'), col('cliente_telefono', 'Teléfono'),
          col('distrito', 'Distrito'), col('piezas', 'Productos / piezas'), col('estado', 'Estado'), col('ruta', 'Ruta', 'entero'),
          col('atendido_en', 'Atendido', 'fechahora'), col('nota', 'Nota del conductor'), col('registrado_por', 'Registrado por'),
        ],
        filas: rows,
        resumen: [{ etiqueta: 'Registros', valor: rows.length }, ...Object.entries(porTipo).map(([t, n]) => ({ etiqueta: t, valor: n }))],
      };
    },
  },

  usuarios: {
    titulo: 'Usuarios',
    descripcion: 'Actividad de cada cuenta en el periodo: ventas registradas, rutas y entregas.',
    async ejecutar(f) {
      const { rows } = await query(
        `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.creado_en, u.ultimo_acceso,
                (SELECT COUNT(*) FROM pedidos p WHERE p.vendedor_id = u.id AND p.fecha_entrega BETWEEN $1 AND $2)::int AS pedidos,
                (SELECT COALESCE(SUM(p.total_pedido), 0) FROM pedidos p
                  WHERE p.vendedor_id = u.id AND p.categoria = 'venta' AND p.estado <> 'cancelado' AND p.fecha_entrega BETWEEN $1 AND $2) AS monto,
                (SELECT COUNT(*) FROM rutas r WHERE r.repartidor_id = u.id AND r.fecha BETWEEN $1 AND $2)::int AS rutas_conductor,
                (SELECT COUNT(*) FROM rutas r WHERE r.asistente_id = u.id AND r.fecha BETWEEN $1 AND $2)::int AS rutas_auxiliar,
                (SELECT COUNT(*) FROM ruta_paradas x JOIN rutas r ON r.id = x.ruta_id
                  WHERE (r.repartidor_id = u.id OR r.asistente_id = u.id) AND x.estado = 'completada' AND r.fecha BETWEEN $1 AND $2)::int AS entregas,
                (SELECT COUNT(*) FROM ruta_paradas x JOIN rutas r ON r.id = x.ruta_id
                  WHERE (r.repartidor_id = u.id OR r.asistente_id = u.id) AND x.estado = 'incidencia' AND r.fecha BETWEEN $1 AND $2)::int AS incidencias,
                (SELECT COUNT(*) FROM pedido_historial h WHERE h.usuario_id = u.id
                  AND (h.creado_en AT TIME ZONE 'America/Lima')::date BETWEEN $1 AND $2)::int AS cambios
         FROM usuarios u WHERE NOT u.pendiente
         ORDER BY u.activo DESC, u.rol, u.nombre`,
        [f.desde, f.hasta]
      );
      return {
        columnas: [
          col('nombre', 'Nombre'), col('email', 'Correo'), col('rol', 'Perfil'), col('activo', 'Activo'),
          col('ultimo_acceso', 'Último acceso', 'fechahora'), col('pedidos', 'Pedidos registrados', 'entero'),
          col('monto', 'Monto vendido', 'monto'), col('rutas_conductor', 'Rutas (conductor)', 'entero'),
          col('rutas_auxiliar', 'Rutas (auxiliar)', 'entero'), col('entregas', 'Entregas', 'entero'),
          col('incidencias', 'Incidencias', 'entero'), col('cambios', 'Cambios en pedidos', 'entero'), col('creado_en', 'Cuenta creada', 'fechahora'),
        ],
        filas: rows.map((r) => ({ ...r, activo: r.activo ? 'Sí' : 'No' })),
        resumen: [
          { etiqueta: 'Cuentas', valor: rows.length },
          { etiqueta: 'Activas', valor: rows.filter((r) => r.activo).length },
        ],
      };
    },
  },
};

const ORDEN = ['pedidos', 'bsale', 'productos', 'variacion_precio', 'rutas', 'recorrido', 'flota', 'incidencias', 'inversa', 'usuarios'];

/** Primer día del mes actual (Lima). */
const inicioDeMes = () => `${hoy().slice(0, 8)}01`;

export const ReporteController = {
  listar(_req, res) {
    res.json(ORDEN.map((clave) => {
      const r = REPORTES[clave];
      return { clave, titulo: r.titulo, descripcion: r.descripcion, filtros: r.filtros ?? [] };
    }));
  },

  async ejecutar(req, res) {
    const reporte = REPORTES[req.params.clave];
    if (!reporte) throw new HttpError(404, 'Reporte no encontrado');
    const fechas = leerCampos({ desde: req.query.desde || inicioDeMes(), hasta: req.query.hasta || hoy() },
      { desde: { tipo: 'fecha' }, hasta: { tipo: 'fecha' } });
    if (fechas.desde > fechas.hasta) throw new HttpError(400, 'La fecha "desde" es posterior a "hasta"');
    // los filtros de lista solo aceptan valores del catálogo
    const extra = {};
    for (const filtro of reporte.filtros ?? []) {
      const v = req.query[filtro.clave];
      if (v == null || v === '') { extra[filtro.clave] = null; continue; }
      if (filtro.opciones && !filtro.opciones.includes(v)) throw new HttpError(400, `${filtro.etiqueta}: valor inválido`);
      extra[filtro.clave] = String(v);
    }
    const r = await reporte.ejecutar({ ...fechas, ...extra });
    res.json({ clave: req.params.clave, titulo: reporte.titulo, ...fechas, ...r });
  },
};

