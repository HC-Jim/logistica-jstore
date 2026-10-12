// Fragmento SQL compartido por los reportes de Logística y de RRHH (desempeño).
// Usa $1 = desde y $2 = hasta.

/** Kilómetros reales recorridos por ruta según el GPS del conductor (o del auxiliar si no hay del conductor). */
export const CTE_GPS = `
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
