import { query, withTransaction } from '../config/db.js';
import { PLATAFORMA_ENCARGO, PLATAFORMA_INVERSA, TIPOS_POR_CATEGORIA } from '../config/catalogos.js';
import { CAMPOS_VENDEDOR, ESTADOS_EDITABLES } from '../config/permisos.js';
import { HttpError } from '../utils/http.js';
import { registrarRuta } from './historial.js';

const PLATAFORMA_FIJA = { inversa: PLATAFORMA_INVERSA, encargo: PLATAFORMA_ENCARGO };

const SELECT_PEDIDO = `
  SELECT p.*,
         ub.departamento, ub.provincia, ub.distrito,
         v.nombre AS vendedor_nombre,
         rp.ruta_id, rp.orden AS ruta_orden, rp.estado AS parada_estado,
         r.numero AS ruta_numero, r.fecha AS ruta_fecha,
         rep.nombre AS repartidor_nombre,
         ubi.nombre AS ubicacion_nombre, ori.nombre AS origen_nombre
  FROM pedidos p
  JOIN usuarios v          ON v.id = p.vendedor_id
  LEFT JOIN ubigeos ub     ON ub.codigo = p.ubigeo
  -- parada actual: la activa (pendiente) o, si no hay, la más reciente
  LEFT JOIN LATERAL (
    SELECT x.id, x.ruta_id, x.orden, x.estado FROM ruta_paradas x
    WHERE x.pedido_id = p.id ORDER BY (x.estado = 'pendiente') DESC, x.id DESC LIMIT 1
  ) rp ON true
  LEFT JOIN rutas r        ON r.id = rp.ruta_id
  LEFT JOIN usuarios rep   ON rep.id = r.repartidor_id
  LEFT JOIN ubicaciones ubi ON ubi.id = p.ubicacion_id
  LEFT JOIN ubicaciones ori ON ori.id = p.origen_ubicacion_id`;

const iguales = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));

async function historial(client, pedidoId, usuarioId, accion, detalle = null) {
  await client.query(
    'INSERT INTO pedido_historial (pedido_id, usuario_id, accion, detalle) VALUES ($1, $2, $3, $4)',
    [pedidoId, usuarioId, accion, detalle && JSON.stringify(detalle)]
  );
}

/**
 * Saca el pedido de su ruta actual (parada pendiente). Las paradas ya atendidas
 * (incidencia o completada) se conservan como historial de la ruta.
 * Devuelve el id de la ruta o null.
 */
async function quitarDeRuta(client, pedidoId, usuarioId, motivo) {
  const { rows: [parada] } = await client.query(
    `DELETE FROM ruta_paradas WHERE pedido_id = $1 AND estado = 'pendiente' RETURNING ruta_id`,
    [pedidoId]
  );
  if (!parada) return null;
  await registrarRuta(client, parada.ruta_id, usuarioId, 'pedido_retirado', { pedido_id: pedidoId, motivo });
  await client.query(
    'UPDATE rutas SET polyline = NULL, distancia_metros = NULL, duracion_segundos = NULL WHERE id = $1',
    [parada.ruta_id]
  );
  return parada.ruta_id;
}

/** Bloquea el pedido y verifica que el usuario pueda tocarlo. */
async function bloquear(client, id, usuario) {
  const { rows: [pedido] } = await client.query('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
  if (!pedido) throw new HttpError(404, 'Pedido no encontrado');
  if (usuario.rol === 'vendedor' && pedido.vendedor_id !== usuario.id) {
    throw new HttpError(403, 'Solo puedes modificar tus propias ventas');
  }
  return pedido;
}

/**
 * Completa SKU, descripción y precio de cada línea a partir del catálogo.
 * En logística inversa y encargos se aceptan líneas libres (pieza o producto que no está en el catálogo),
 * y los encargos pueden no tener productos.
 */
async function prepararItems(client, items, categoria = 'venta') {
  if (!Array.isArray(items) || (items.length === 0 && categoria !== 'encargo')) {
    throw new HttpError(400, 'El pedido debe tener al menos un producto');
  }
  const libres = items.filter((i) => !i.producto_id);
  if (libres.length && categoria === 'venta') {
    throw new HttpError(400, 'En una venta todos los productos deben ser del catálogo');
  }
  const ids = [...new Set(items.filter((i) => i.producto_id).map((i) => i.producto_id))];
  const { rows } = await client.query(
    'SELECT id, sku, descripcion, precio FROM productos WHERE id = ANY($1::int[])',
    [ids]
  );
  const porId = new Map(rows.map((p) => [p.id, p]));
  return items.map((it) => {
    if (!it.producto_id) {
      if (!it.descripcion) throw new HttpError(400, 'Describe la pieza o producto');
      return { producto_id: null, sku: 'LIBRE', descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario ?? 0 };
    }
    const producto = porId.get(it.producto_id);
    if (!producto) throw new HttpError(400, `Producto ${it.producto_id} no existe`);
    return {
      producto_id: producto.id,
      sku: producto.sku,
      descripcion: producto.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario ?? producto.precio,
    };
  });
}

async function insertarItems(client, pedidoId, items) {
  for (const it of items) {
    await client.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, sku, descripcion, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pedidoId, it.producto_id, it.sku, it.descripcion, it.cantidad, it.precio_unitario]
    );
  }
}

const sumaItems = (items) => items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);

export const PedidoModel = {
  async listar({ fecha, desde, hasta, estado, vendedorId, plataforma, tipoPedido, buscar, sinRuta, categoria } = {}) {
    const cond = [];
    const params = [];
    const agregar = (sql, valor) => {
      params.push(valor);
      cond.push(sql.replace('?', `$${params.length}`));
    };
    if (fecha) agregar('p.fecha_entrega = ?', fecha);
    if (desde) agregar('p.fecha_entrega >= ?', desde);
    if (hasta) agregar('p.fecha_entrega <= ?', hasta);
    if (estado) agregar('p.estado = ANY(?::text[])', estado.split(','));
    if (vendedorId) agregar('p.vendedor_id = ?', vendedorId);
    if (plataforma) agregar('p.plataforma = ?', plataforma);
    if (tipoPedido) agregar('p.tipo_pedido = ?', tipoPedido);
    if (categoria) agregar('p.categoria = ANY(?::text[])', categoria.split(','));
    if (sinRuta) cond.push(`NOT EXISTS (SELECT 1 FROM ruta_paradas a WHERE a.pedido_id = p.id AND a.estado = 'pendiente')`);
    if (buscar) {
      agregar(
        `(p.cliente_nombre ILIKE ? OR p.numero_pedido ILIKE $${params.length + 1}
          OR p.documento_bsale ILIKE $${params.length + 1} OR p.cliente_telefono ILIKE $${params.length + 1}
          OR p.id::text = $${params.length + 2})`,
        `%${buscar}%`
      );
      params.push(buscar.trim());
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT * FROM (
         ${SELECT_PEDIDO}
         ${where}
       ) x
       CROSS JOIN LATERAL (
         SELECT string_agg(i.descripcion || ' / ' || i.cantidad || ' und', E'\\n' ORDER BY i.id) AS productos
         FROM pedido_items i WHERE i.pedido_id = x.id
       ) it
       ORDER BY x.fecha_entrega DESC, x.id DESC
       LIMIT 1000`,
      params
    );
    return rows;
  },

  async obtener(id) {
    const { rows: [pedido] } = await query(`${SELECT_PEDIDO} WHERE p.id = $1`, [id]);
    if (!pedido) return null;
    const [{ rows: items }, { rows: hist }] = await Promise.all([
      query('SELECT * FROM pedido_items WHERE pedido_id = $1 ORDER BY id', [id]),
      query(
        `SELECT h.id, h.accion, h.detalle, h.creado_en, u.nombre AS usuario
         FROM pedido_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id
         WHERE h.pedido_id = $1 ORDER BY h.id DESC`,
        [id]
      ),
    ]);
    return { ...pedido, items, historial: hist };
  },

  async crear({ datos, items, usuario }) {
    return withTransaction(async (client) => {
      const lineas = await prepararItems(client, items, datos.categoria);
      const fila = {
        ...datos,
        total_pedido: datos.total_pedido ?? sumaItems(lineas) + (datos.precio_envio ?? 0),
        creado_por: usuario.id,
      };
      const cols = Object.keys(fila);
      const { rows: [{ id }] } = await client.query(
        `INSERT INTO pedidos (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((c) => fila[c])
      );
      await insertarItems(client, id, lineas);
      await historial(client, id, usuario.id, 'creado');
      return id;
    });
  },

  /**
   * Edita un pedido. El vendedor solo puede cambiar CAMPOS_VENDEDOR de sus ventas
   * y no puede tocar los productos.
   */
  async actualizar(id, { datos, items, usuario }) {
    return withTransaction(async (client) => {
      const actual = await bloquear(client, id, usuario);
      if (!ESTADOS_EDITABLES.includes(actual.estado)) {
        throw new HttpError(409, `No se puede editar un pedido ${actual.estado}`);
      }
      if (usuario.rol === 'almacen' && actual.categoria !== 'encargo') {
        throw new HttpError(403, 'Almacén solo puede editar encargos logísticos');
      }
      // la categoría no cambia; su plataforma y sus tipos están fijados
      if (PLATAFORMA_FIJA[actual.categoria]) datos.plataforma = PLATAFORMA_FIJA[actual.categoria];
      if (datos.tipo_pedido && !TIPOS_POR_CATEGORIA[actual.categoria].includes(datos.tipo_pedido)) {
        throw new HttpError(400, `Tipo "${datos.tipo_pedido}" no corresponde a este registro`);
      }

      const cambios = Object.fromEntries(
        Object.entries(datos)
          .filter(([campo, valor]) => !iguales(actual[campo], valor))
          .map(([campo, valor]) => [campo, [actual[campo], valor]])
      );
      if (usuario.rol === 'vendedor') {
        const prohibidos = Object.keys(cambios).filter((c) => !CAMPOS_VENDEDOR.has(c));
        if (prohibidos.length) throw new HttpError(403, `No puedes modificar: ${prohibidos.join(', ')}`);
        if (items) throw new HttpError(403, 'No puedes modificar los productos del pedido');
      }

      if (items) {
        const lineas = await prepararItems(client, items, actual.categoria);
        await client.query('DELETE FROM pedido_items WHERE pedido_id = $1', [id]);
        await insertarItems(client, id, lineas);
        cambios.productos = ['(anteriores)', lineas.map((l) => `${l.sku} x${l.cantidad}`).join(', ')];
      }

      const campos = Object.keys(cambios).filter((c) => c !== 'productos');
      if (campos.length) {
        await client.query(
          `UPDATE pedidos SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')}, actualizado_en = now()
           WHERE id = $${campos.length + 1}`,
          [...campos.map((c) => cambios[c][1]), id]
        );
      }
      if (cambios.lat || cambios.lng) {
        // la ruta debe volver a trazarse con la nueva ubicación
        await client.query(
          `UPDATE rutas SET polyline = NULL
           WHERE id = (SELECT ruta_id FROM ruta_paradas WHERE pedido_id = $1 AND estado = 'pendiente')`,
          [id]
        );
      }
      if (Object.keys(cambios).length) await historial(client, id, usuario.id, 'editado', cambios);
      return id;
    });
  },

  /** Cambios de estado manuales (logística). "ruteado" se asigna desde las rutas. */
  async cambiarEstado(id, { estado, motivo, usuario }) {
    const permitidos = {
      entregado: ['pendiente', 'ruteado', 'incidencia'],
      incidencia: ['ruteado'],
      cancelado: ['pendiente', 'ruteado', 'incidencia'],
      pendiente: ['incidencia', 'cancelado'],
    };
    if (!permitidos[estado]) throw new HttpError(400, `No se puede pasar manualmente a "${estado}"`);
    if (['cancelado', 'incidencia'].includes(estado) && !motivo) {
      throw new HttpError(400, 'Indica el motivo');
    }

    return withTransaction(async (client) => {
      const actual = await bloquear(client, id, usuario);
      if (actual.estado === estado) return id;
      if (!permitidos[estado].includes(actual.estado)) {
        throw new HttpError(409, `Un pedido ${actual.estado} no puede pasar a ${estado}`);
      }

      if (estado === 'cancelado' || estado === 'pendiente') {
        await quitarDeRuta(client, id, usuario.id, estado === 'cancelado' ? `cancelado: ${motivo}` : 'vuelve a pendiente');
      } else {
        const { rows: [parada] } = await client.query(
          `UPDATE ruta_paradas SET estado = $1, nota = COALESCE($2, nota), completada_en = now()
           WHERE pedido_id = $3 AND estado = 'pendiente' RETURNING ruta_id`,
          [estado === 'entregado' ? 'completada' : 'incidencia', motivo ?? null, id]
        );
        if (parada) {
          await registrarRuta(client, parada.ruta_id, usuario.id, 'parada_atendida', {
            pedido_id: id, estado: estado === 'entregado' ? 'completada' : 'incidencia', nota: motivo, origen: 'web',
          });
        }
      }
      await client.query('UPDATE pedidos SET estado = $1, actualizado_en = now() WHERE id = $2', [estado, id]);
      await historial(client, id, usuario.id, 'estado', { de: actual.estado, a: estado, motivo });
      return id;
    });
  },

  /** Cambia la fecha de entrega. Si estaba en una ruta, sale de ella y vuelve a pendiente. */
  async reprogramar(id, { fecha, motivo, usuario }) {
    return withTransaction(async (client) => {
      const actual = await bloquear(client, id, usuario);
      if (!ESTADOS_EDITABLES.includes(actual.estado)) {
        throw new HttpError(409, `No se puede reprogramar un pedido ${actual.estado}`);
      }
      const rutaId = await quitarDeRuta(client, id, usuario.id, `reprogramado al ${fecha}`);
      await client.query(
        `UPDATE pedidos SET fecha_entrega = $1, estado = 'pendiente', actualizado_en = now() WHERE id = $2`,
        [fecha, id]
      );
      await historial(client, id, usuario.id, 'reprogramado', {
        de: actual.fecha_entrega,
        a: fecha,
        motivo,
        quitado_de_ruta: rutaId,
        estado_anterior: actual.estado,
      });
      return id;
    });
  },

  async observacionesAlmacen(id, { texto, usuario }) {
    return withTransaction(async (client) => {
      const actual = await bloquear(client, id, usuario);
      await client.query(
        'UPDATE pedidos SET observaciones_almacen = $1, actualizado_en = now() WHERE id = $2',
        [texto, id]
      );
      await historial(client, id, usuario.id, 'observacion_almacen', {
        de: actual.observaciones_almacen,
        a: texto,
      });
      return id;
    });
  },
};

export { historial as registrarHistorial };
