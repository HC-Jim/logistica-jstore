import { query, withTransaction } from '../config/db.js';
import { MOVILIDAD_COMPARTIDA } from '../config/catalogos.js';
import { HttpError } from '../utils/http.js';
import { historialRuta, registrarRuta } from './historial.js';
import { registrarHistorial } from './pedido.model.js';

/** Nombres legibles de vehículo y personas para el historial de la ruta. */
async function nombresEquipo(client, { vehiculoId, repartidorId, asistenteId }) {
  const { rows: [n] } = await client.query(
    `SELECT (SELECT nombre FROM vehiculos WHERE id = $1) AS vehiculo,
            (SELECT nombre FROM usuarios WHERE id = $2) AS conductor,
            (SELECT nombre FROM usuarios WHERE id = $3) AS auxiliar`,
    [vehiculoId ?? null, repartidorId ?? null, asistenteId ?? null]
  );
  return n;
}

const SELECT_RUTA = `
  SELECT r.*, rep.nombre AS repartidor_nombre, rep.telefono AS repartidor_telefono,
         asi.nombre AS asistente_nombre,
         v.nombre AS vehiculo_nombre, v.tipo AS vehiculo_tipo, v.placa AS vehiculo_placa,
         c.total_paradas, c.paradas_atendidas, c.completadas, c.incidencias, c.canceladas, c.pendientes, c.pedidos, c.despachados,
         (SELECT COUNT(*) FROM ruta_mensajes m WHERE m.ruta_id = r.id) AS mensajes
  FROM rutas r
  LEFT JOIN usuarios rep  ON rep.id = r.repartidor_id
  LEFT JOIN usuarios asi  ON asi.id = r.asistente_id
  LEFT JOIN vehiculos v   ON v.id = r.vehiculo_id
  CROSS JOIN LATERAL (
    SELECT COUNT(*) AS total_paradas,
           COUNT(*) FILTER (WHERE x.estado <> 'pendiente') AS paradas_atendidas,
           COUNT(*) FILTER (WHERE x.estado = 'completada') AS completadas,
           COUNT(*) FILTER (WHERE x.estado = 'incidencia') AS incidencias,
           COUNT(*) FILTER (WHERE x.estado = 'cancelada') AS canceladas,
           COUNT(*) FILTER (WHERE x.estado = 'pendiente') AS pendientes,
           COUNT(*) FILTER (WHERE x.pedido_id IS NOT NULL) AS pedidos,
           COUNT(*) FILTER (WHERE x.pedido_id IS NOT NULL AND x.despachado_en IS NOT NULL) AS despachados
    FROM ruta_paradas x WHERE x.ruta_id = r.id
  ) c`;

/** Paradas de una o varias rutas, con los datos del pedido que necesitan el mapa y la app. */
export async function paradasDe(rutaIds) {
  const { rows } = await query(
    `SELECT rp.id, rp.ruta_id, rp.orden, rp.pedido_id, rp.estado, rp.nota, rp.completada_en, rp.foto_url, p.vendedor_id,
            rp.descripcion,
            COALESCE(rp.descripcion, p.cliente_nombre) AS titulo,
            COALESCE(p.direccion, rp.direccion) AS direccion,
            COALESCE(p.lat, rp.lat) AS lat,
            COALESCE(p.lng, rp.lng) AS lng,
            p.cliente_nombre, p.cliente_telefono, p.detalle_domicilio, p.referencia, p.link_ubicacion,
            p.tipo_pedido, p.agencia, p.precio_envio, p.total_pedido, p.cobrar, p.medio_pago,
            p.nota AS nota_pedido, p.estado AS estado_pedido, p.documento_bsale,
            p.plataforma, p.numero_pedido, p.enviar_a, p.pago_agencia,
            p.categoria, p.motivo, p.pedido_relacionado,
            ven.nombre AS vendedor_nombre,
            rp.despachado_en, des.nombre AS despachado_por_nombre,
            ub.distrito, ub.provincia, ub.departamento,
            COALESCE((
              SELECT json_agg(json_build_object('sku', i.sku, 'descripcion', i.descripcion,
                                                'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
                                                'subtotal', i.subtotal) ORDER BY i.id)
              FROM pedido_items i WHERE i.pedido_id = p.id
            ), '[]') AS items
     FROM ruta_paradas rp
     LEFT JOIN pedidos p  ON p.id = rp.pedido_id
     LEFT JOIN ubigeos ub ON ub.codigo = p.ubigeo
     LEFT JOIN usuarios ven ON ven.id = p.vendedor_id
     LEFT JOIN usuarios des ON des.id = rp.despachado_por
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

/** El conductor (opcional al abrir la ruta) debe ser Conductor; el auxiliar, Auxiliar logístico o Conductor. */
async function validarRepartidores(client, [conductorId, auxiliarId]) {
  const { rows } = await client.query(
    'SELECT id, rol FROM usuarios WHERE id = ANY($1::int[]) AND activo',
    [[conductorId, auxiliarId].filter(Boolean)]
  );
  const rol = new Map(rows.map((u) => [u.id, u.rol]));
  if (conductorId && rol.get(conductorId) !== 'repartidor') {
    throw new HttpError(400, 'El conductor debe ser un usuario activo con perfil Conductor');
  }
  if (auxiliarId) {
    if (auxiliarId === conductorId) throw new HttpError(400, 'El conductor y el auxiliar deben ser personas distintas');
    if (!['auxiliar', 'repartidor'].includes(rol.get(auxiliarId))) {
      throw new HttpError(400, 'El auxiliar debe ser un usuario activo con perfil Auxiliar logístico o Conductor');
    }
  }
}

/** Un vehículo no puede estar en dos rutas el mismo día. */
async function validarVehiculo(client, { fecha, vehiculoId, rutaId = 0 }) {
  if (!vehiculoId) return;
  const { rows: [v] } = await client.query('SELECT nombre, tipo, activo FROM vehiculos WHERE id = $1', [vehiculoId]);
  if (!v?.activo) throw new HttpError(400, 'El vehículo no existe o está inactivo');
  if (MOVILIDAD_COMPARTIDA.includes(v.tipo)) return; // a pie o en bus: varias rutas a la vez
  const { rows: [otra] } = await client.query(
    'SELECT numero FROM rutas WHERE fecha = $1 AND vehiculo_id = $2 AND id <> $3',
    [fecha, vehiculoId, rutaId]
  );
  if (otra) throw new HttpError(409, `${v.nombre} ya está asignado a la Ruta ${otra.numero} ese día`);
}

export const RutaModel = {
  /** Lista rutas: las del día (fecha) o el historial (desde/hasta y filtros). */
  async listar({ fecha, desde, hasta, numero, repartidorId, vehiculoId, estado, limite = 500 } = {}) {
    const cond = [];
    const params = [];
    const agregar = (sql, valor) => { params.push(valor); cond.push(sql.replaceAll('?', `$${params.length}`)); };
    if (fecha) agregar('r.fecha = ?', fecha);
    if (desde) agregar('r.fecha >= ?', desde);
    if (hasta) agregar('r.fecha <= ?', hasta);
    if (numero) agregar('r.numero = ?', numero);
    if (repartidorId) agregar('(r.repartidor_id = ? OR r.asistente_id = ?)', repartidorId);
    if (vehiculoId) agregar('r.vehiculo_id = ?', vehiculoId);
    if (estado) agregar('r.estado = ?', estado);
    params.push(limite);
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(
      `${SELECT_RUTA} ${where} ORDER BY r.fecha DESC, r.numero LIMIT $${params.length}`,
      params
    );
    return rows;
  },

  async obtener(id) {
    const { rows: [ruta] } = await query(`${SELECT_RUTA} WHERE r.id = $1`, [id]);
    if (!ruta) return null;
    return { ...ruta, paradas: await paradasDe([id]) };
  },

  /** Abre la Ruta N del día (si no se indica el número, la siguiente libre). */
  async crear({ fecha, numero, nombre, vehiculoId, repartidorId, asistenteId, usuario }) {
    return withTransaction(async (client) => {
      // serializa la creación de rutas del mismo día para no repetir números
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rutas:${fecha}`]);
      if (!numero) {
        const { rows: [m] } = await client.query('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM rutas WHERE fecha = $1', [fecha]);
        numero = m.n;
      } else {
        const { rows: [ya] } = await client.query('SELECT 1 FROM rutas WHERE fecha = $1 AND numero = $2', [fecha, numero]);
        if (ya) throw new HttpError(409, `La Ruta ${numero} de ese día ya existe`);
      }
      await validarRepartidores(client, [repartidorId, asistenteId]);
      await validarVehiculo(client, { fecha, vehiculoId });
      const { rows: [r] } = await client.query(
        `INSERT INTO rutas (fecha, numero, nombre, vehiculo_id, repartidor_id, asistente_id, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [fecha, numero, nombre ?? null, vehiculoId ?? null, repartidorId ?? null, asistenteId ?? null, usuario.id]
      );
      await registrarRuta(client, r.id, usuario.id, 'creada', {
        numero, ...(await nombresEquipo(client, { vehiculoId, repartidorId, asistenteId })),
      });
      return r.id;
    });
  },

  /** Cambia nombre, vehículo, conductor o auxiliar (undefined = no cambiar, null = quitar). */
  async actualizar(id, { nombre, vehiculoId, repartidorId, asistenteId, estado }, usuario) {
    return withTransaction(async (client) => {
      const ruta = await bloquearRuta(client, id);
      const valor = (nuevo, actual) => (nuevo === undefined ? actual : nuevo);
      const repartidor = valor(repartidorId, ruta.repartidor_id);
      const asistente = valor(asistenteId, ruta.asistente_id);
      const vehiculo = valor(vehiculoId, ruta.vehiculo_id);
      await validarRepartidores(client, [repartidor, asistente]);
      if (vehiculo !== ruta.vehiculo_id) await validarVehiculo(client, { fecha: ruta.fecha, vehiculoId: vehiculo, rutaId: id });
      if (estado && estado !== 'planificada' && !repartidor) {
        throw new HttpError(400, 'Asigna un conductor antes de iniciar la ruta');
      }
      await client.query(
        `UPDATE rutas SET nombre = $1, repartidor_id = $2, asistente_id = $3, vehiculo_id = $4, estado = $5,
                          actualizado_en = now()
         WHERE id = $6`,
        [valor(nombre, ruta.nombre), repartidor, asistente, vehiculo, estado ?? ruta.estado, id]
      );
      const antes = await nombresEquipo(client, { vehiculoId: ruta.vehiculo_id, repartidorId: ruta.repartidor_id, asistenteId: ruta.asistente_id });
      const ahora = await nombresEquipo(client, { vehiculoId: vehiculo, repartidorId: repartidor, asistenteId: asistente });
      const cambios = Object.fromEntries(
        Object.keys(ahora).filter((k) => antes[k] !== ahora[k]).map((k) => [k, [antes[k], ahora[k]]])
      );
      if (estado && estado !== ruta.estado) cambios.estado = [ruta.estado, estado];
      if (Object.keys(cambios).length) await registrarRuta(client, id, usuario?.id, 'editada', cambios);
      return id;
    });
  },

  /** Cierra la ruta del día. Exige que no queden pedidos pendientes en ella. */
  async finalizar(id, usuario) {
    return withTransaction(async (client) => {
      const ruta = await bloquearRuta(client, id);
      if (ruta.estado === 'finalizada') return id;
      const { rows: [{ pendientes }] } = await client.query(
        `SELECT COUNT(*)::int AS pendientes FROM ruta_paradas WHERE ruta_id = $1 AND estado = 'pendiente'`,
        [id]
      );
      if (pendientes) {
        throw new HttpError(409, `Quedan ${pendientes} parada(s) pendientes: márcalas como entregadas, reprograma o cancela esos pedidos`);
      }
      await client.query(`UPDATE rutas SET estado = 'finalizada', finalizada_en = now(), actualizado_en = now() WHERE id = $1`, [id]);
      await registrarRuta(client, id, usuario?.id, 'finalizada');
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
      const porPedido = new Map(existentes.filter((p) => p.pedido_id && p.estado === 'pendiente').map((p) => [p.pedido_id, p]));

      // Normaliza: un pedido que ya está en esta ruta se trata como parada existente
      const lista = paradas.map((p) => (!p.id && p.pedido_id && porPedido.has(p.pedido_id)
        ? { id: porPedido.get(p.pedido_id).id }
        : p));

      const conservadas = new Set(lista.filter((p) => p.id).map((p) => p.id));
      for (const p of lista.filter((x) => x.id)) {
        if (!porId.has(p.id)) throw new HttpError(400, `La parada ${p.id} no pertenece a esta ruta`);
      }

      const registro = { agregados: [], quitados: [] };
      // Paradas quitadas
      for (const p of existentes.filter((x) => !conservadas.has(x.id))) {
        registro.quitados.push(p.pedido_id ? `#${p.pedido_id}` : p.descripcion);
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
          `SELECT p.id, p.estado, p.fecha_entrega, p.lat, r.numero AS ruta_numero
           FROM pedidos p
           LEFT JOIN ruta_paradas rp ON rp.pedido_id = p.id AND rp.estado = 'pendiente'
           LEFT JOIN rutas r ON r.id = rp.ruta_id
           WHERE p.id = ANY($1::int[]) FOR UPDATE OF p`,
          [nuevosPedidos]
        );
        const info = new Map(rows.map((r) => [r.id, r]));
        for (const pid of nuevosPedidos) {
          const p = info.get(pid);
          if (!p) throw new HttpError(400, `El pedido #${pid} no existe`);
          if (p.ruta_numero) throw new HttpError(409, `El pedido #${pid} ya está en la Ruta ${p.ruta_numero}`);
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
          await registrarHistorial(client, p.pedido_id, usuario.id, 'ruteado', { ruta_id: id, motivo: `Ruta ${ruta.numero} del ${ruta.fecha}` });
          registro.agregados.push(`#${p.pedido_id}`);
        } else {
          if (!p.descripcion) throw new HttpError(400, 'Las acciones libres necesitan una descripción');
          if (p.lat == null || p.lng == null) throw new HttpError(400, `"${p.descripcion}" necesita ubicación`);
          await client.query(
            `INSERT INTO ruta_paradas (ruta_id, orden, descripcion, direccion, lat, lng)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, orden, p.descripcion, p.direccion ?? null, p.lat, p.lng]
          );
          registro.agregados.push(p.descripcion);
        }
      }
      const ordenAntes = existentes.filter((x) => conservadas.has(x.id)).sort((a, b) => a.orden - b.orden).map((x) => x.id);
      const ordenAhora = lista.filter((x) => x.id).map((x) => x.id);
      const reordenado = ordenAntes.join() !== ordenAhora.join();
      if (registro.agregados.length || registro.quitados.length || reordenado) {
        await registrarRuta(client, id, usuario.id, 'paradas', { ...registro, reordenado });
      }

      await client.query(
        `UPDATE rutas SET polyline = NULL, distancia_metros = NULL, duracion_segundos = NULL, actualizado_en = now()
         WHERE id = $1`,
        [id]
      );
      return id;
    });
  },

  async guardarTrazado(id, { orden, distanciaMetros, duracionSegundos, polyline }, usuario) {
    return withTransaction(async (client) => {
      await registrarRuta(client, id, usuario?.id, orden ? 'optimizada' : 'trazada', {
        km: Math.round((distanciaMetros ?? 0) / 100) / 10, minutos: Math.round((duracionSegundos ?? 0) / 60),
      });
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
      if (estado === 'completada' && parada.pedido_id && !parada.foto_url) {
        throw new HttpError(400, 'Toma la foto del cliente con el producto antes de marcarlo');
      }

      await client.query(
        'UPDATE ruta_paradas SET estado = $1, nota = $2, completada_en = now() WHERE id = $3',
        [estado, nota ?? null, paradaId]
      );
      await registrarRuta(client, parada.ruta_id, usuario.id, 'parada_atendida', {
        pedido_id: parada.pedido_id, descripcion: parada.descripcion, estado, nota, origen: 'app',
      });
      if (parada.pedido_id) {
        const estadoPedido = estado === 'completada' ? 'entregado' : 'incidencia';
        await client.query('UPDATE pedidos SET estado = $1, actualizado_en = now() WHERE id = $2', [estadoPedido, parada.pedido_id]);
        await registrarHistorial(client, parada.pedido_id, usuario.id, 'estado', {
          de: 'ruteado', a: estadoPedido, motivo: nota, origen: 'app repartidor',
        });
      }

      // La primera parada atendida inicia la ruta. Termina al volver al almacén
      // (lo detecta el GPS) o cuando el conductor o logística la finalizan.
      await client.query(`UPDATE rutas SET estado = 'en_curso', actualizado_en = now() WHERE id = $1`, [parada.ruta_id]);
      return parada.ruta_id;
    });
  },

  // --- Chat de la ruta ---

  /** Almacén marca (o desmarca) pedidos de la ruta como entregados al conductor. */
  async despachar(rutaId, { paradaIds, despachado, usuario }) {
    return withTransaction(async (client) => {
      const ruta = await bloquearRuta(client, rutaId);
      if (ruta.estado === 'finalizada') throw new HttpError(409, 'La ruta ya está finalizada');
      const { rowCount } = await client.query(
        `UPDATE ruta_paradas
         SET despachado_en = CASE WHEN $3 THEN COALESCE(despachado_en, now()) ELSE NULL END,
             despachado_por = CASE WHEN $3 THEN COALESCE(despachado_por, $4) ELSE NULL END
         WHERE ruta_id = $1 AND id = ANY($2::int[]) AND pedido_id IS NOT NULL AND estado = 'pendiente'`,
        [rutaId, paradaIds, despachado, usuario.id]
      );
      if (rowCount) {
        const { rows } = await client.query('SELECT pedido_id FROM ruta_paradas WHERE id = ANY($1::int[]) AND pedido_id IS NOT NULL', [paradaIds]);
        await registrarRuta(client, rutaId, usuario.id, despachado ? 'despachado' : 'despacho_anulado', {
          pedidos: rows.map((r) => `#${r.pedido_id}`),
        });
      }
      return rowCount;
    });
  },

  historial: historialRuta,

  async mensajes(rutaId, { despues = 0, limite = 200 } = {}) {
    const { rows } = await query(
      `SELECT m.id, m.ruta_id, m.texto, m.creado_en, m.usuario_id, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM ruta_mensajes m LEFT JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.ruta_id = $1 AND m.id > $2
       ORDER BY m.id DESC LIMIT $3`,
      [rutaId, despues, limite]
    );
    return rows.reverse(); // del más antiguo al más reciente
  },

  async enviarMensaje(rutaId, { texto, usuario }) {
    const { rows: [m] } = await query(
      'INSERT INTO ruta_mensajes (ruta_id, usuario_id, texto) VALUES ($1, $2, $3) RETURNING id',
      [rutaId, usuario.id, texto]
    );
    return m.id;
  },

  /** Foto de la entrega (se puede volver a tomar mientras la parada esté pendiente). */
  async guardarFotoParada(paradaId, usuario, guardar) {
    const { rows: [parada] } = await query(
      `SELECT rp.id, rp.ruta_id, rp.estado, r.repartidor_id, r.asistente_id, r.estado AS estado_ruta
       FROM ruta_paradas rp JOIN rutas r ON r.id = rp.ruta_id WHERE rp.id = $1`,
      [paradaId]
    );
    if (!parada) throw new HttpError(404, 'Parada no encontrada');
    if (![parada.repartidor_id, parada.asistente_id].includes(usuario.id)) throw new HttpError(403, 'Esta parada no es de tu ruta');
    if (parada.estado !== 'pendiente' || parada.estado_ruta === 'finalizada') {
      throw new HttpError(409, 'La parada ya fue atendida');
    }
    const url = await guardar(`ruta${parada.ruta_id}-parada${paradaId}`);
    await query('UPDATE ruta_paradas SET foto_url = $1 WHERE id = $2', [url, paradaId]);
    return url;
  },

  /** Pasa una parada pendiente a otra ruta del mismo día (queda al final de la ruta destino). */
  async moverParada(paradaId, destinoId, usuario) {
    return withTransaction(async (client) => {
      const { rows: [p] } = await client.query(
        `SELECT rp.*, r.fecha, r.numero FROM ruta_paradas rp JOIN rutas r ON r.id = rp.ruta_id WHERE rp.id = $1 FOR UPDATE OF rp`,
        [paradaId]
      );
      if (!p) throw new HttpError(404, 'Parada no encontrada');
      if (p.estado !== 'pendiente') throw new HttpError(409, 'Solo se pueden pasar a otra ruta las paradas pendientes');
      if (p.ruta_id === destinoId) throw new HttpError(400, 'La parada ya está en esa ruta');
      const [origen, destino] = [await bloquearRuta(client, p.ruta_id), await bloquearRuta(client, destinoId)];
      if (destino.estado === 'finalizada') throw new HttpError(409, `La Ruta ${destino.numero} ya está finalizada`);
      if (String(destino.fecha) !== String(origen.fecha)) throw new HttpError(400, 'Solo se puede pasar a otra ruta del mismo día');

      const { rows: [{ n }] } = await client.query('SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM ruta_paradas WHERE ruta_id = $1', [destinoId]);
      // el paquete cambia de vehículo: el despacho se vuelve a marcar en la ruta nueva
      await client.query(
        'UPDATE ruta_paradas SET ruta_id = $1, orden = $2, despachado_en = NULL, despachado_por = NULL WHERE id = $3',
        [destinoId, n, paradaId]
      );
      // los trazados de ambas rutas ya no sirven
      await client.query(
        `UPDATE rutas SET polyline = NULL, distancia_metros = NULL, duracion_segundos = NULL, restante_clave = NULL, actualizado_en = now()
         WHERE id = ANY($1::int[])`,
        [[origen.id, destino.id]]
      );
      const detalle = { pedido_id: p.pedido_id, descripcion: p.descripcion };
      await registrarRuta(client, origen.id, usuario.id, 'pedido_movido', { ...detalle, a_ruta: destino.numero });
      await registrarRuta(client, destino.id, usuario.id, 'pedido_movido', { ...detalle, de_ruta: origen.numero });
      if (p.pedido_id) {
        await registrarHistorial(client, p.pedido_id, usuario.id, 'ruteado', {
          motivo: `Pasó de la Ruta ${origen.numero} a la Ruta ${destino.numero}`, ruta_id: destino.id,
        });
      }
      return { origen, destino, pedidoId: p.pedido_id };
    });
  },

  /** Última posición de cada conductor y auxiliar activo (para verlos aunque no tengan ruta). */
  async posicionesEquipo() {
    const { rows } = await query(
      `SELECT u.id AS usuario_id, u.nombre, u.rol, x.lat, x.lng, x.velocidad, x.registrado_en, x.ruta_id
       FROM usuarios u
       JOIN LATERAL (
         SELECT lat, lng, velocidad, registrado_en, ruta_id FROM posiciones
         WHERE usuario_id = u.id AND registrado_en > now() - interval '12 hours'
         ORDER BY registrado_en DESC LIMIT 1
       ) x ON true
       WHERE u.activo AND u.rol IN ('repartidor', 'auxiliar')
       ORDER BY u.nombre`
    );
    return rows;
  },

  async registrarPosicion({ usuario, lat, lng, precision, velocidad, rumbo, rutaId }) {
    await query(
      `INSERT INTO posiciones (usuario_id, ruta_id, lat, lng, precision_m, velocidad, rumbo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuario.id, rutaId ?? null, lat, lng, precision ?? null, velocidad ?? null, rumbo ?? null]
    );
    // De vez en cuando se borran las posiciones viejas para que la tabla no crezca sin límite
    if (Math.random() < 0.01) {
      await query(`DELETE FROM posiciones WHERE registrado_en < now() - interval '30 days'`);
    }
  },
};
