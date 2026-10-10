import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { registrarRuta } from '../models/historial.js';
import { HttpError } from '../utils/http.js';
import { modoViaje, trazarRestante } from './rutas.service.js';

/** Si el conductor se aleja más que esto del camino calculado, se recalcula (p. ej. desvío por tráfico o cierre). */
const DESVIO_METROS = 250;
/** Mínimo entre recálculos por desvío: cada cálculo es una consulta a Google. */
const ESPERA_MS = 60_000;
/** A esta distancia del almacén, sin paradas pendientes, la ruta se da por terminada. */
const LLEGADA_METROS = 150;

/** Decodifica una polilínea de Google en [{ lat, lng }]. */
export function decodificarPolyline(texto) {
  const puntos = [];
  let i = 0, lat = 0, lng = 0;
  while (i < texto.length) {
    for (const eje of ['lat', 'lng']) {
      let resultado = 0, desplazamiento = 0, b;
      do {
        b = texto.charCodeAt(i++) - 63;
        resultado |= (b & 0x1f) << desplazamiento;
        desplazamiento += 5;
      } while (b >= 0x20);
      const delta = resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
      if (eje === 'lat') lat += delta; else lng += delta;
    }
    puntos.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return puntos;
}

/** Distancia en metros entre dos puntos (aproximación plana, suficiente dentro de una ciudad). */
export function metros(a, b) {
  const x = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  const y = (b.lat - a.lat) * 111320;
  return Math.hypot(x, y);
}

/** Distancia del punto al camino (a cada segmento de la polilínea). */
function distanciaAlCamino(p, camino) {
  if (!camino.length) return Infinity;
  const k = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const xy = (q) => [(q.lng - p.lng) * k, (q.lat - p.lat) * 111320];
  let minimo = Infinity;
  for (let i = 0; i < camino.length; i++) {
    const [ax, ay] = xy(camino[i]);
    const [bx, by] = i + 1 < camino.length ? xy(camino[i + 1]) : [ax, ay];
    const dx = bx - ax, dy = by - ay, largo2 = dx * dx + dy * dy;
    const t = largo2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / largo2)) : 0;
    minimo = Math.min(minimo, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return minimo;
}

/** Paradas pendientes con ubicación, en el orden de la ruta. */
async function pendientesConUbicacion(rutaId, db = { query }) {
  const { rows } = await db.query(
    `SELECT rp.id, rp.orden, COALESCE(rp.descripcion, p.cliente_nombre) AS titulo,
            COALESCE(p.lat, rp.lat)::float AS lat, COALESCE(p.lng, rp.lng)::float AS lng
     FROM ruta_paradas rp LEFT JOIN pedidos p ON p.id = rp.pedido_id
     WHERE rp.ruta_id = $1 AND rp.estado = 'pendiente'
     ORDER BY rp.orden, rp.id`,
    [rutaId]
  );
  return rows;
}

const deposito = () => ({ tipo: 'almacen', parada_id: null, titulo: env.deposito.nombre, lat: env.deposito.lat, lng: env.deposito.lng });

/** Formato que reciben la app y la web. */
function respuesta(r) {
  if (!r.restante_polyline) return null;
  return {
    destino: r.restante_destino,
    distancia_metros: r.restante_destino?.distancia_metros ?? null,
    duracion_segundos: r.restante_destino?.duracion_segundos ?? null,
    polyline: r.restante_tramo,
    restante: { distancia_metros: r.restante_distancia, duracion_segundos: r.restante_duracion, polyline: r.restante_polyline },
    calculado_en: r.restante_en,
  };
}

/** Guarda el camino restante (resultado de Google) en la ruta. */
async function guardar(db, rutaId, clave, paradas, t) {
  const primera = t.legs[0] ?? { distanciaMetros: t.distanciaMetros, duracionSegundos: t.duracionSegundos, polyline: t.polyline };
  const destino = {
    ...(paradas[0] ? { tipo: 'parada', parada_id: paradas[0].id, titulo: paradas[0].titulo, lat: paradas[0].lat, lng: paradas[0].lng } : deposito()),
    distancia_metros: primera.distanciaMetros,
    duracion_segundos: primera.duracionSegundos,
  };
  const { rows: [r] } = await db.query(
    `UPDATE rutas SET restante_polyline = $2, restante_tramo = $3, restante_distancia = $4, restante_duracion = $5,
            restante_destino = $6, restante_clave = $7, restante_en = now()
     WHERE id = $1 RETURNING *`,
    [rutaId, t.polyline, primera.polyline, t.distanciaMetros, t.duracionSegundos, JSON.stringify(destino), clave]
  );
  return respuesta(r);
}

/**
 * Camino que le queda al conductor: desde su posición, por las paradas pendientes, hasta el almacén.
 * Solo consulta a Google cuando cambian las paradas pendientes (entregó, canceló, reordenaron...)
 * o cuando el conductor se desvía del camino; si no, devuelve el último cálculo.
 */
export async function actualizarRestante(rutaId, pos) {
  const { rows: [ruta] } = await query(
    'SELECT r.*, v.tipo AS vehiculo_tipo FROM rutas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = $1',
    [rutaId]
  );
  if (!ruta || ruta.estado !== 'en_curso') return null;

  const paradas = await pendientesConUbicacion(rutaId);
  const clave = paradas.map((p) => p.id).join(',') || 'almacen';
  const reciente = ruta.restante_en && Date.now() - new Date(ruta.restante_en) < ESPERA_MS;
  if (ruta.restante_polyline && clave === ruta.restante_clave) {
    if (reciente) return respuesta(ruta);
    const camino = decodificarPolyline(ruta.restante_polyline);
    if (distanciaAlCamino(pos, camino) <= DESVIO_METROS) return respuesta(ruta);
  }
  const t = await trazarRestante(pos, paradas, { modo: modoViaje(ruta.vehiculo_tipo) });
  return guardar({ query }, rutaId, clave, paradas, t);
}

/** Al volver al almacén sin paradas pendientes, la ruta se finaliza sola. */
export async function verificarLlegada(rutaId, pos, usuario) {
  if (metros(pos, env.deposito) > LLEGADA_METROS) return false;
  return withTransaction(async (client) => {
    const { rows: [r] } = await client.query(
      `SELECT r.estado,
              (SELECT COUNT(*)::int FROM ruta_paradas x WHERE x.ruta_id = r.id) AS total,
              (SELECT COUNT(*)::int FROM ruta_paradas x WHERE x.ruta_id = r.id AND x.estado = 'pendiente') AS pendientes
       FROM rutas r WHERE r.id = $1 FOR UPDATE`,
      [rutaId]
    );
    if (!r || r.estado !== 'en_curso' || !r.total || r.pendientes) return false;
    await client.query(`UPDATE rutas SET estado = 'finalizada', finalizada_en = now(), actualizado_en = now() WHERE id = $1`, [rutaId]);
    await registrarRuta(client, rutaId, usuario.id, 'finalizada', { origen: 'llegada al almacén (GPS)' });
    return true;
  });
}

/**
 * Reordena las paradas pendientes por el camino más corto desde la posición indicada
 * (las ya atendidas quedan primero, en su orden). Devuelve el nuevo camino restante.
 */
export async function reoptimizar(rutaId, pos, usuario) {
  const { rows: [ruta] } = await query(
    'SELECT r.estado, v.tipo AS vehiculo_tipo FROM rutas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = $1',
    [rutaId]
  );
  if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
  if (ruta.estado === 'finalizada') throw new HttpError(409, 'La ruta ya está finalizada');
  const paradas = await pendientesConUbicacion(rutaId);
  if (paradas.length < 2) throw new HttpError(400, 'Hay menos de 2 paradas pendientes: no hay nada que reordenar');

  const t = await trazarRestante(pos, paradas, { optimizar: true, modo: modoViaje(ruta.vehiculo_tipo) });
  const ordenadas = t.orden.map((i) => paradas[i]);
  return withTransaction(async (client) => {
    const { rows: todas } = await client.query(
      'SELECT id, estado FROM ruta_paradas WHERE ruta_id = $1 ORDER BY orden, id FOR UPDATE',
      [rutaId]
    );
    const conUbicacion = new Set(ordenadas.map((p) => p.id));
    const nuevoOrden = [
      ...todas.filter((p) => p.estado !== 'pendiente').map((p) => p.id),
      ...ordenadas.map((p) => p.id),
      ...todas.filter((p) => p.estado === 'pendiente' && !conUbicacion.has(p.id)).map((p) => p.id),
    ];
    await client.query(
      `UPDATE ruta_paradas rp SET orden = x.n
       FROM unnest($1::int[]) WITH ORDINALITY AS x(id, n) WHERE rp.id = x.id`,
      [nuevoOrden]
    );
    await registrarRuta(client, rutaId, usuario.id, 'paradas_reordenadas', {
      origen: usuario.rol === 'repartidor' || usuario.rol === 'auxiliar' ? 'app' : 'web',
      orden: ordenadas.map((p) => p.titulo),
    });
    const clave = ordenadas.map((p) => p.id).join(',');
    return guardar(client, rutaId, clave, ordenadas, t);
  });
}
