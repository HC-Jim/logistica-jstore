import { query } from '../config/db.js';

/** Registra un cambio en el historial de una ruta (dentro de la transacción si se pasa `client`). */
export async function registrarRuta(client, rutaId, usuarioId, accion, detalle = null) {
  await (client ?? { query }).query(
    'INSERT INTO ruta_historial (ruta_id, usuario_id, accion, detalle) VALUES ($1, $2, $3, $4)',
    [rutaId, usuarioId ?? null, accion, detalle && JSON.stringify(detalle)]
  );
}

export async function historialRuta(rutaId) {
  const { rows } = await query(
    `SELECT h.id, h.accion, h.detalle, h.creado_en, u.nombre AS usuario, u.rol AS usuario_rol
     FROM ruta_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id
     WHERE h.ruta_id = $1 ORDER BY h.id DESC`,
    [rutaId]
  );
  return rows;
}
