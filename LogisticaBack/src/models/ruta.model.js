import { query, withTransaction } from '../config/db.js';
import { HttpError } from '../utils/http.js';
import { registrarHistorial } from './pedido.model.js';

const SELECT_RUTA = `
  SELECT r.*, rep.nombre AS repartidor_nombre, rep.telefono AS repartidor_telefono,
         asi.nombre AS asistente_nombre,
         (SELECT COUNT(*) FROM ruta_paradas x WHERE x.ruta_id = r.id) AS total_paradas,
         (SELECT COUNT(*) FROM ruta_paradas x WHERE x.ruta_id = r.id AND x.estado <> 'pendiente') AS paradas_atendidas
  FROM rutas r
  JOIN usuarios rep      ON rep.id = r.repartidor_id
  LEFT JOIN usuarios asi ON asi.id = r.asistente_id`;

/** Paradas de una o varias rutas, con los datos del pedido que necesitan el mapa y la app. */
export async function paradasDe(rutaIds) {
  const { rows } = await query(
    `SELECT rp.id, rp.ruta_id, rp.orden, rp.pedido_id, rp.estado, rp.nota, rp.completada_en,
            rp.descripcion,
            COALESCE(rp.descripcion, p.cliente_nombre) AS titulo,
            COALESCE(p.direccion, rp.direccion) AS direccion,
            COALESCE(p.lat, rp.lat) AS lat,
            COALESCE(p.lng, rp.lng) AS lng,
            p.cliente_nombre, p.cliente_telefono, p.detalle_domicilio, p.referencia, p.link_ubicacion,
            p.tipo_pedido, p.agencia, p.precio_envio, p.total_pedido, p.cobrar, p.medio_pago,
            p.nota AS nota_pedido, p.estado AS estado_pedido, p.documento_bsale,
            ub.distrito, ub.provincia, ub.departamento,
            COALESCE((
              SELECT json_agg(json_build_object('sku', i.sku, 'descripcion', i.descripcion,
                                                'cantidad', i.cantidad, 'subtotal', i.subtotal) ORDER BY i.id)
              FROM pedido_items i WHERE i.pedido_id = p.id
            ), '[]') AS items
     FROM ruta_paradas rp
     LEFT JOIN pedidos p  ON p.id = rp.pedido_id
     LEFT JOIN ubigeos ub ON ub.codigo = p.ubigeo
     WHERE rp.ruta_id = ANY($1::int[])
     ORDER BY rp.ruta_id, rp.orden`,
    [rutaIds]
  );
  return rows;
}

async function bloquearRuta(client, id) {
  const { rows: [ruta] } = await client.query('SELECT * FROM rutas WHERE id = $1 FOR UPDATE', [id]);
  if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
  return ruta;
}

async function validarRepartidores(client, ids) {
  const lista = ids.filter(Boolean);
  const { rows } = await client.query(
    `SELECT id FROM usuarios WHERE id = ANY($1::int[]) AND rol = 'repartidor' AND activo`,
    [lista]
  );
  if (rows.length !== new Set(lista).size) {
    throw new HttpError(400, 'El repartidor y el asistente deben ser usuarios activos con rol repartidor');
  }
}

export const RutaModel = {
  async listar({ fecha, repartidorId } = {}) {
    const cond = [];
    const params = [];
    if (fecha) { params.push(fecha); cond.push(`r.fecha = $${params.length}`); }
    if (repartidorId) {
      params.push(repartidorId);
      cond.push(`(r.repartidor_id = $${params.length} OR r.asistente_id = $${params.length})`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(`${SELECT_RUTA} ${where} ORDER BY r.fecha DESC, r.id`, params);
    return rows;
  },

  async obtener(id) {
    const { rows: [ruta] } = await query(`${SELECT_RUTA} WHERE r.id = $1`, [id]);
    if (!ruta) return null;
    return { ...ruta, paradas: await paradasDe([id]) };
  },

  async crear({ fecha, nombre, repartidorId, asistenteId, usuario }) {
    return withTransaction(async (client) => {
      await validarRepartidores(client, [repartidorId, asistenteId]);
      const { rows: [r] } = await client.query(
        `INSERT INTO rutas (fecha, nombre, repartidor_id, asistente_id, creado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [fecha, nombre ?? null, repartidorId, asistenteId ?? null, usuario.id]
      );
      return r.id;
    });
  },

  async actualizar(id, { nombre, repartidorId, asistenteId, estado }) {
    return withTransaction(async (client) => {
      const ruta = await bloquearRuta(client, id);
      const repartidor = repartidorId ?? ruta.repartidor_id;
      const asistente = asistenteId === undefined ? ruta.asistente_id : asistenteId;
      await validarRepartidores(client, [repartidor, asistente]);
      await client.query(
        `UPDATE rutas SET nombre = $1, repartidor_id = $2, asistente_id = $3, estado = $4, actualizado_en = now()
         WHERE id = $5`,
        [nombre === undefined ? ruta.nombre : nombre, repartidor, asistente, estado ?? ruta.estado, id]
      );
      return id;
    });
  },

  /** Elimina la ruta; sus pedidos vuelven a "pendiente". No se puede si ya hubo entregas. */
  async eliminar(id, usuario) {
    return withTransaction(async (client) => {
      await bloquearRuta(client, id);
      const { rows: paradas } = await client.query(
        'SELECT pedido_id, estado FROM ruta_paradas WHERE ruta_id = $1',
        [id]
      );
      if (paradas.some((p) => p.estado !== 'pendiente')) {
        throw new HttpError(409, 'La ruta ya tiene paradas atendidas; no se puede eliminar');
      }
      for (const { pedido_id } of paradas.filter((p) => p.pedido_id)) {
        await client.query(`UPDATE pedidos SET estado = 'pendiente', actualizado_en = now() WHERE id = $1`, [pedido_id]);
        await registrarHistorial(client, pedido_id, usuario.id, 'quitado_de_ruta', { ruta_id: id, motivo: 'ruta eliminada' });
      }
      await client.query('DELETE FROM rutas WHERE id = $1', [id]);
    });
  },

  /**
   * Reemplaza la lista ordenada de paradas.
   * Cada elemento es { id } (parada existente), { pedido_id } (agregar pedido)
   * o { descripcion, direccion, lat, lng } (acción libre).
   */
  async guardarParadas(id, paradas, usuario) {
    return withTransaction(async (client) => {
      const ruta = await bloquearRuta(client, id);
      if (ruta.estado === 'finalizada') throw new HttpError(409, 'La ruta ya está finalizada');

      const { rows: existentes } = await client.query(
        'SELECT * FROM ruta_paradas WHERE ruta_id = $1 FOR UPDATE',
        [id]
      );
      const porId = new Map(existentes.map((p) => [p.id, p]));
      const porPedido = new Map(existentes.filter((p) => p.pedido_id).map((p) => [p.pedido_id, p]));

      // Normaliza: un pedido que ya está en esta ruta se trata como parada existente
      const lista = paradas.map((p) => (!p.id && p.pedido_id && porPedido.has(p.pedido_id)
        ? { id: porPedido.get(p.pedido_id).id }
        : p));

      const conservadas = new Set(lista.filter((p) => p.id).map((p) => p.id));
      for (const p of lista.filter((x) => x.id)) {
        if (!porId.has(p.id)) throw new HttpError(400, `La parada ${p.id} no pertenece a esta ruta`);
      }

      // Paradas quitadas
      for (const p of existentes.filter((x) => !conservadas.has(x.id))) {
        if (p.estado !== 'pendiente') {
          throw new HttpError(409, `La parada "${p.descripcion ?? `pedido #${p.pedido_id}`}" ya fue atendida y no se puede quitar`);
        }
        await client.query('DELETE FROM ruta_paradas WHERE id = $1', [p.id]);
        if (p.pedido_id) {
          await client.query(`UPDATE pedidos SET estado = 'pendiente', actualizado_en = now() WHERE id = $1`, [p.pedido_id]);
          await registrarHistorial(client, p.pedido_id, usuario.id, 'quitado_de_ruta', { ruta_id: id });
        }
      }

      // Pedidos nuevos: deben estar pendientes, con ubicación y para la fecha de la ruta
      const nuevosPedidos = lista.filter((p) => !p.id && p.pedido_id).map((p) => p.pedido_id);
      if (nuevosPedidos.length) {
        const { rows } = await client.query(
          `SELECT p.id, p.estado, p.fecha_entrega, p.lat, rp.ruta_id
           FROM pedidos p LEFT JOIN ruta_paradas rp ON rp.pedido_id = p.id
           WHERE p.id = ANY($1::int[]) FOR UPDATE OF p`,
          [nuevosPedidos]
        );
        const info = new Map(rows.map((r) => [r.id, r]));
        for (const pid of nuevosPedidos) {
          const p = info.get(pid);
          if (!p) throw new HttpError(400, `El pedido #${pid} no existe`);
          if (p.ruta_id) throw new HttpError(409, `El pedido #${pid} ya está en la ruta ${p.ruta_id}`);
          if (p.estado !== 'pendiente') throw new HttpError(409, `El pedido #${pid} está ${p.estado}`);
          if (p.fecha_entrega !== ruta.fecha) {
            throw new HttpError(409, `El pedido #${pid} es para el ${p.fecha_entrega}; reprográmalo primero`);
          }
          if (p.lat == null) throw new HttpError(409, `El pedido #${pid} no tiene ubicación en el mapa`);
        }
      }

      // Guarda el orden final
      let orden = 0;
      for (const p of lista) {
        orden += 1;
        if (p.id) {
          await client.query('UPDATE ruta_paradas SET orden = $1 WHERE id = $2', [orden, p.id]);
        } else if (p.pedido_id) {
          await client.query(
            'INSERT INTO ruta_paradas (ruta_id, orden, pedido_id) VALUES ($1, $2, $3)',
            [id, orden, p.pedido_id]
          );
          await client.query(`UPDATE pedidos SET estado = 'ruteado', actualizado_en = now() WHERE id = $1`, [p.pedido_id]);
          await registrarHistorial(client, p.pedido_id, usuario.id, 'ruteado', { ruta_id: id });
        } else {
          if (!p.descripcion) throw new HttpError(400, 'Las acciones libres necesitan una descripción');
          if (p.lat == null || p.lng == null) throw new HttpError(400, `"${p.descripcion}" necesita ubicación`);
          await client.query(
            `INSERT INTO ruta_paradas (ruta_id, orden, descripcion, direccion, lat, lng)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, orden, p.descripcion, p.direccion ?? null, p.lat, p.lng]
          );
        }
      }

      await client.query(
        `UPDATE rutas SET polyline = NULL, distancia_metros = NULL, duracion_segundos = NULL, actualizado_en = now()
         WHERE id = $1`,
        [id]
      );
      return id;
    });
  },

  async guardarTrazado(id, { orden, distanciaMetros, duracionSegundos, polyline }) {
    return withTransaction(async (client) => {
      if (orden) {
        for (const [i, paradaId] of orden.entries()) {
          await client.query('UPDATE ruta_paradas SET orden = $1 WHERE id = $2 AND ruta_id = $3', [i + 1, paradaId, id]);
        }
      }
      await client.query(
        `UPDATE rutas SET distancia_metros = $1, duracion_segundos = $2, polyline = $3, actualizado_en = now()
         WHERE id = $4`,
        [distanciaMetros, duracionSegundos, polyline, id]
      );
    });
  },

  /** Última posición conocida (últimas 12 h) de cada usuario. */
  async ultimasPosiciones(usuarioIds) {
    if (!usuarioIds.length) return [];
    const { rows } = await query(
      `SELECT DISTINCT ON (usuario_id) usuario_id, ruta_id, lat, lng, precision_m, velocidad, rumbo, registrado_en
       FROM posiciones
       WHERE usuario_id = ANY($1::int[]) AND registrado_en > now() - interval '12 hours'
       ORDER BY usuario_id, registrado_en DESC`,
      [usuarioIds]
    );
    return rows;
  },

  /** Recorrido real del día de un usuario (para dibujar el rastro). */
  async recorrido(usuarioId, rutaId) {
    const { rows } = await query(
      `SELECT lat, lng, registrado_en FROM posiciones
       WHERE usuario_id = $1 AND ruta_id = $2 ORDER BY registrado_en`,
      [usuarioId, rutaId]
    );
    return rows;
  },

  // --- App del repartidor ---

  /** El repartidor (o su asistente) marca una parada. Sincroniza el pedido y la ruta. */
  async atenderParada(paradaId, { estado, nota, usuario }) {
    return withTransaction(async (client) => {
      const { rows: [parada] } = await client.query(
        `SELECT rp.*, r.repartidor_id, r.asistente_id, r.estado AS estado_ruta
         FROM ruta_paradas rp JOIN rutas r ON r.id = rp.ruta_id
         WHERE rp.id = $1 FOR UPDATE OF rp, r`,
        [paradaId]
      );
      if (!parada) throw new HttpError(404, 'Parada no encontrada');
      if (![parada.repartidor_id, parada.asistente_id].includes(usuario.id)) {
        throw new HttpError(403, 'Esta parada no es de tu ruta');
      }
      if (parada.estado_ruta === 'finalizada') throw new HttpError(409, 'La ruta ya está finalizada');
      if (estado === 'incidencia' && !nota) throw new HttpError(400, 'Describe la incidencia');

      await client.query(
        'UPDATE ruta_paradas SET estado = $1, nota = $2, completada_en = now() WHERE id = $3',
        [estado, nota ?? null, paradaId]
      );
      if (parada.pedido_id) {
        const estadoPedido = estado === 'completada' ? 'entregado' : 'incidencia';
        await client.query('UPDATE pedidos SET estado = $1, actualizado_en = now() WHERE id = $2', [estadoPedido, parada.pedido_id]);
        await registrarHistorial(client, parada.pedido_id, usuario.id, 'estado', {
          de: 'ruteado', a: estadoPedido, motivo: nota, origen: 'app repartidor',
        });
      }

      // Inicia la ruta con la primera parada y la cierra con la última
      const { rows: [{ pendientes }] } = await client.query(
        `SELECT COUNT(*)::int AS pendientes FROM ruta_paradas WHERE ruta_id = $1 AND estado = 'pendiente'`,
        [parada.ruta_id]
      );
      await client.query(
        `UPDATE rutas SET estado = $1, actualizado_en = now() WHERE id = $2`,
        [pendientes === 0 ? 'finalizada' : 'en_curso', parada.ruta_id]
      );
      return parada.ruta_id;
    });
  },

  async registrarPosicion({ usuario, lat, lng, precision, velocidad, rumbo, rutaId }) {
    await query(
      `INSERT INTO posiciones (usuario_id, ruta_id, lat, lng, precision_m, velocidad, rumbo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuario.id, rutaId ?? null, lat, lng, precision ?? null, velocidad ?? null, rumbo ?? null]
    );
  },
};
