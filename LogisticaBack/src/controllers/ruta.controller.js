import { ESTADOS_PARADA, ESTADOS_RUTA } from '../config/catalogos.js';
import { PedidoModel } from '../models/pedido.model.js';
import { paradasDe, RutaModel } from '../models/ruta.model.js';
import { modoViaje, trazarRuta } from '../services/rutas.service.js';
import { guardarFoto } from '../services/fotos.service.js';
import { actualizarRestante, reoptimizar, verificarLlegada } from '../services/seguimiento.service.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError, idParam } from '../utils/http.js';
import { env } from '../config/env.js';
import { notificar, usuariosConRol } from '../services/notificaciones.service.js';

const dia = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const equipo = (r) => [r.repartidor_id, r.asistente_id].filter(Boolean);
const datosRuta = (r, extra = {}) => ({ ruta_id: r.id, fecha: r.fecha, ...extra });

/** Avisa a quienes entraron o salieron del equipo de la ruta. */
async function avisarCambioEquipo(antes, ahora, usuario) {
  const previos = new Set(antes ? equipo(antes) : []);
  const nuevos = new Set(equipo(ahora));
  const vehiculo = ahora.vehiculo_nombre ? ` · ${ahora.vehiculo_nombre}` : '';
  await notificar([...nuevos].filter((u) => !previos.has(u)), {
    tipo: 'ruta_asignada',
    titulo: `Te asignaron la Ruta ${ahora.numero} del ${dia(ahora.fecha)}`,
    cuerpo: `${ahora.total_paradas} parada(s)${vehiculo}`,
    url: `/rutas/${ahora.id}`,
    datos: datosRuta(ahora),
  }, { excepto: usuario.id });
  await notificar([...previos].filter((u) => !nuevos.has(u)), {
    tipo: 'ruta_retirada',
    titulo: `Ya no estás en la Ruta ${ahora.numero} del ${dia(ahora.fecha)}`,
    cuerpo: 'Logística te quitó de esta ruta.',
    datos: datosRuta(ahora),
  }, { excepto: usuario.id });
}

const CAMPOS_RUTA = {
  fecha: { tipo: 'fecha', requerido: true },
  numero: { tipo: 'entero' },
  nombre: { tipo: 'texto', max: 80 },
  vehiculo_id: { tipo: 'entero' },
  repartidor_id: { tipo: 'entero' },
  asistente_id: { tipo: 'entero' },
  estado: { tipo: 'enum', lista: ESTADOS_RUTA },
};

/** El chat de una ruta lo ven logística y el conductor/auxiliar asignados. */
async function rutaConAcceso(req) {
  const ruta = await RutaModel.obtener(idParam(req.params.id));
  if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
  const esEquipo = ['repartidor', 'auxiliar'].includes(req.user.rol);
  if (esEquipo && ![ruta.repartidor_id, ruta.asistente_id].includes(req.user.id)) {
    throw new HttpError(403, 'Esta ruta no es tuya');
  }
  return ruta;
}

const CAMPOS_PARADA = {
  id: { tipo: 'entero' },
  pedido_id: { tipo: 'entero' },
  descripcion: { tipo: 'texto', max: 255 },
  direccion: { tipo: 'texto', max: 255 },
  lat: { tipo: 'coord', max: 90 },
  lng: { tipo: 'coord', max: 180 },
};

const leerPosicion = (body) => leerCampos(
  body,
  { lat: { tipo: 'coord', max: 90, requerido: true }, lng: { tipo: 'coord', max: 180, requerido: true } },
  { requeridos: true }
);

/** Ruta de la que el usuario es conductor o auxiliar. */
async function rutaDelEquipo(idTexto, usuario) {
  const ruta = await RutaModel.obtener(idParam(idTexto));
  if (!ruta || ![ruta.repartidor_id, ruta.asistente_id].includes(usuario.id)) throw new HttpError(404, 'Ruta no encontrada');
  return ruta;
}

const fechaQuery = (q) => leerCampos({ fecha: q.fecha || hoy() }, { fecha: { tipo: 'fecha' } }).fecha;

/** Une rutas, paradas y última posición del repartidor y su asistente. */
async function armarRutas(rutas) {
  const ids = rutas.map((r) => r.id);
  const usuarios = [...new Set(rutas.flatMap((r) => [r.repartidor_id, r.asistente_id]).filter(Boolean))];
  const [paradas, posiciones] = await Promise.all([paradasDe(ids), RutaModel.ultimasPosiciones(usuarios)]);
  const pos = new Map(posiciones.map((p) => [p.usuario_id, p]));
  return rutas.map((r) => ({
    ...r,
    paradas: paradas.filter((p) => p.ruta_id === r.id),
    // posición del repartidor; si no hay, la del asistente
    posicion: pos.get(r.repartidor_id) ?? pos.get(r.asistente_id) ?? null,
  }));
}

export const RutaController = {
  async listar(req, res) {
    res.json(await RutaModel.listar({ fecha: req.query.fecha && fechaQuery(req.query) }));
  },

  /** Historial: rutas entre fechas, filtrables por número, conductor/auxiliar, vehículo y estado. */
  async historial(req, res) {
    const f = leerCampos(req.query, {
      desde: { tipo: 'fecha' },
      hasta: { tipo: 'fecha' },
      numero: { tipo: 'entero' },
      repartidor_id: { tipo: 'entero' },
      vehiculo_id: { tipo: 'entero' },
      estado: { tipo: 'enum', lista: ESTADOS_RUTA },
    });
    res.json(await RutaModel.listar({
      desde: f.desde, hasta: f.hasta, numero: f.numero, repartidorId: f.repartidor_id,
      vehiculoId: f.vehiculo_id, estado: f.estado, limite: 1000,
    }));
  },

  /** PATCH /rutas/:id/despacho  { parada_ids: [..], despachado: true|false } */
  async despachar(req, res) {
    const id = idParam(req.params.id);
    const ids = req.body?.parada_ids;
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Indica las paradas (parada_ids)');
    if (typeof req.body.despachado !== 'boolean') throw new HttpError(400, 'despachado debe ser true o false');
    await RutaModel.despachar(id, { paradaIds: ids.map(idParam), despachado: req.body.despachado, usuario: req.user });
    res.json(await RutaModel.obtener(id));
  },

  async finalizar(req, res) {
    const id = await RutaModel.finalizar(idParam(req.params.id), req.user);
    res.json(await RutaModel.obtener(id));
  },

  async historialCambios(req, res) {
    res.json(await RutaModel.historial(idParam(req.params.id)));
  },

  async mensajes(req, res) {
    const ruta = await rutaConAcceso(req);
    const despues = Math.max(Number(req.query.despues) || 0, 0);
    res.json(await RutaModel.mensajes(ruta.id, { despues }));
  },

  async enviarMensaje(req, res) {
    const ruta = await rutaConAcceso(req);
    const { texto } = leerCampos(req.body, { texto: { tipo: 'texto', max: 2000, requerido: true } }, { requeridos: true });
    const id = await RutaModel.enviarMensaje(ruta.id, { texto, usuario: req.user });
    // Del equipo de la ruta → logística (y el compañero); de logística → equipo de la ruta
    const delEquipo = ['repartidor', 'auxiliar'].includes(req.user.rol);
    const destinos = delEquipo ? [...(await usuariosConRol(['admin', 'planificador'])), ...equipo(ruta)] : equipo(ruta);
    await notificar(destinos, {
      tipo: 'mensaje',
      titulo: `💬 Ruta ${ruta.numero} · ${req.user.nombre}`,
      cuerpo: texto,
      url: `/rutas/${ruta.id}`,
      datos: datosRuta(ruta, { abrir: 'chat' }),
    }, { excepto: req.user.id });
    res.status(201).json((await RutaModel.mensajes(ruta.id, { despues: id - 1 }))[0]);
  },

  async obtener(req, res) {
    const ruta = await RutaModel.obtener(idParam(req.params.id));
    if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
    res.json(ruta);
  },

  async crear(req, res) {
    const d = leerCampos(req.body, CAMPOS_RUTA, { requeridos: true });
    const id = await RutaModel.crear({
      fecha: d.fecha, numero: d.numero, nombre: d.nombre, vehiculoId: d.vehiculo_id,
      repartidorId: d.repartidor_id, asistenteId: d.asistente_id, usuario: req.user,
    });
    const ruta = await RutaModel.obtener(id);
    await avisarCambioEquipo(null, ruta, req.user);
    res.status(201).json(ruta);
  },

  async actualizar(req, res) {
    const d = leerCampos(req.body, CAMPOS_RUTA);
    const id = idParam(req.params.id);
    if (d.estado === 'finalizada') throw new HttpError(400, 'Usa "Finalizar ruta" para cerrarla');
    const antes = await RutaModel.obtener(id);
    await RutaModel.actualizar(id, {
      nombre: d.nombre, vehiculoId: d.vehiculo_id, repartidorId: d.repartidor_id,
      asistenteId: d.asistente_id, estado: d.estado,
    }, req.user);
    const ruta = await RutaModel.obtener(id);
    if (antes) await avisarCambioEquipo(antes, ruta, req.user);
    res.json(ruta);
  },

  async eliminar(req, res) {
    await RutaModel.eliminar(idParam(req.params.id), req.user);
    res.status(204).end();
  },

  async guardarParadas(req, res) {
    if (!Array.isArray(req.body?.paradas)) throw new HttpError(400, 'Envía { paradas: [...] }');
    const paradas = req.body.paradas.map((p) => leerCampos(p, CAMPOS_PARADA));
    const id = idParam(req.params.id);
    const antes = await RutaModel.obtener(id);
    await RutaModel.guardarParadas(id, paradas, req.user);
    const ruta = await RutaModel.obtener(id);
    // Avisar al equipo qué cambió (solo pedidos y acciones agregados o quitados)
    const claves = (r) => new Set(r.paradas.map((p) => (p.pedido_id ? `#${p.pedido_id}` : p.descripcion)));
    const a = claves(antes ?? { paradas: [] });
    const b = claves(ruta);
    const agregados = [...b].filter((k) => !a.has(k));
    const quitados = [...a].filter((k) => !b.has(k));
    if ((agregados.length || quitados.length) && antes) {
      await notificar(equipo(ruta), {
        tipo: 'ruta_modificada',
        titulo: `Ruta ${ruta.numero} actualizada`,
        cuerpo: [agregados.length && `+${agregados.length} parada(s)`, quitados.length && `−${quitados.length} parada(s)`,
          `ahora ${ruta.total_paradas}`].filter(Boolean).join(' · '),
        url: `/rutas/${ruta.id}`,
        datos: datosRuta(ruta),
      }, { excepto: req.user.id });
    }
    res.json(ruta);
  },

  /** Traza la ruta con Google; con { optimizar: true } también reordena las paradas pendientes. */
  async trazar(req, res) {
    const id = idParam(req.params.id);
    const ruta = await RutaModel.obtener(id);
    if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
    const optimizar = req.body?.optimizar === true;

    // Las paradas ya atendidas mantienen su lugar al inicio; solo se optimizan las pendientes
    const atendidas = ruta.paradas.filter((p) => p.estado !== 'pendiente');
    const pendientes = ruta.paradas.filter((p) => p.estado === 'pendiente');
    const aTrazar = optimizar ? pendientes : ruta.paradas;
    const t = await trazarRuta(aTrazar, { optimizar, modo: modoViaje(ruta.vehiculo_tipo) });
    const orden = optimizar
      ? [...atendidas.map((p) => p.id), ...t.orden.map((i) => pendientes[i].id)]
      : null;
    await RutaModel.guardarTrazado(id, { ...t, orden }, req.user);
    res.json(await RutaModel.obtener(id));
  },

  /** Pedidos de la fecha que aún no están en ninguna ruta (para planificar). */
  async pedidosSinRuta(req, res) {
    res.json(await PedidoModel.listar({ fecha: fechaQuery(req.query), estado: 'pendiente', sinRuta: true }));
  },

  /** Panel en vivo: rutas del día con paradas, trazado y posición actual del repartidor. */
  async monitoreo(req, res) {
    const fecha = fechaQuery(req.query);
    const rutas = await armarRutas(await RutaModel.listar({ fecha }));
    const sinRuta = await PedidoModel.listar({ fecha, estado: 'pendiente,incidencia', sinRuta: true });
    // conductores y auxiliares que comparten su ubicación (con o sin ruta); solo tiene sentido para hoy
    const equipo = fecha === hoy()
      ? await RutaModel.posicionesEquipo().catch((err) => { console.error('Posiciones del equipo:', err.message); return []; })
      : [];
    const enRuta = new Map(rutas.flatMap((r) => [[r.repartidor_id, r], [r.asistente_id, r]]).filter(([u]) => u));
    const conductores = equipo.map((c) => {
      const r = enRuta.get(c.usuario_id);
      return { ...c, ruta_id: r?.id ?? null, ruta_numero: r?.numero ?? null, ruta_estado: r?.estado ?? null };
    });
    res.json({ fecha, deposito: env.deposito, rutas, sinRuta, conductores, generado: new Date().toISOString() });
  },

  async recorrido(req, res) {
    const ruta = await RutaModel.obtener(idParam(req.params.id));
    if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
    res.json(await RutaModel.recorrido(ruta.repartidor_id, ruta.id));
  },

  // --- API para la app Flutter del repartidor ---

  async misRutas(req, res) {
    const rutas = await RutaModel.listar({ fecha: fechaQuery(req.query), repartidorId: req.user.id });
    res.json({ deposito: env.deposito, rutas: await armarRutas(rutas) });
  },

  async iniciarRuta(req, res) {
    const id = idParam(req.params.id);
    const ruta = await RutaModel.obtener(id);
    if (!ruta || ![ruta.repartidor_id, ruta.asistente_id].includes(req.user.id)) {
      throw new HttpError(404, 'Ruta no encontrada');
    }
    if (ruta.estado === 'planificada') await RutaModel.actualizar(id, { estado: 'en_curso' }, req.user);
    res.json(await RutaModel.obtener(id));
  },

  async atenderParada(req, res) {
    const { estado, nota } = leerCampos(
      req.body,
      { estado: { tipo: 'enum', lista: ESTADOS_PARADA.filter((e) => e !== 'pendiente'), requerido: true }, nota: { tipo: 'texto', max: 1000 } },
      { requeridos: true }
    );
    const paradaId = idParam(req.params.id);
    const rutaId = await RutaModel.atenderParada(paradaId, { estado, nota, usuario: req.user });
    const ruta = await RutaModel.obtener(rutaId);
    if (estado === 'incidencia') {
      const p = ruta.paradas.find((x) => x.id === paradaId);
      await notificar(await usuariosConRol(['admin', 'planificador']), {
        tipo: 'incidencia',
        titulo: `⚠ Incidencia en la Ruta ${ruta.numero}`,
        cuerpo: `${p?.titulo ?? 'Parada'}: ${nota}`,
        url: p?.pedido_id ? `/pedidos/${p.pedido_id}` : `/rutas/${ruta.id}`,
        datos: datosRuta(ruta, { pedido_id: p?.pedido_id }),
      }, { excepto: req.user.id });
    }
    res.json(ruta);
  },

  /**
   * Camino que le queda al conductor desde su posición: tramo hasta la próxima parada pendiente
   * (o el almacén) y el resto de la ruta. Se recalcula solo si hace falta.
   */
  async tramoActual(req, res) {
    const pos = leerPosicion(req.body);
    const ruta = await rutaDelEquipo(req.params.id, req.user);
    if (ruta.estado !== 'en_curso') throw new HttpError(409, 'La ruta no está en curso');
    const r = await actualizarRestante(ruta.id, pos);
    if (!r) throw new HttpError(409, 'La ruta no está en curso');
    res.json(r);
  },

  /** El conductor reordena sus paradas pendientes por el camino más corto desde donde está. */
  async reoptimizarApp(req, res) {
    const pos = leerPosicion(req.body);
    const ruta = await rutaDelEquipo(req.params.id, req.user);
    res.json(await reoptimizar(ruta.id, pos, req.user));
  },

  /** Logística reordena las pendientes desde la última posición del conductor (o el almacén). */
  async reoptimizarWeb(req, res) {
    const id = idParam(req.params.id);
    const ruta = await RutaModel.obtener(id);
    if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
    const [ultima] = (await RutaModel.ultimasPosiciones([ruta.repartidor_id, ruta.asistente_id].filter(Boolean)))
      .sort((x, y) => new Date(y.registrado_en) - new Date(x.registrado_en));
    const pos = ultima ? { lat: Number(ultima.lat), lng: Number(ultima.lng) } : env.deposito;
    const r = await reoptimizar(id, pos, req.user);
    await notificar([ruta.repartidor_id, ruta.asistente_id], {
      tipo: 'ruta_modificada',
      titulo: `Ruta ${ruta.numero}: logística reordenó tus paradas`,
      cuerpo: r?.destino?.titulo ? `Próxima: ${r.destino.titulo}` : null,
      datos: datosRuta(ruta),
    }, { excepto: req.user.id });
    res.json(r);
  },

  /** Foto del cliente con el producto (obligatoria para marcar la entrega). Cuerpo: la imagen. */
  async subirFoto(req, res) {
    const tipo = (req.headers['content-type'] ?? '').split(';')[0].trim();
    const url = await RutaModel.guardarFotoParada(idParam(req.params.id), req.user, (nombre) => guardarFoto(req.body, tipo, nombre));
    res.json({ foto_url: url });
  },

  /** El conductor da por terminada la ruta (volvió al almacén). */
  async finalizarApp(req, res) {
    const ruta = await rutaDelEquipo(req.params.id, req.user);
    await RutaModel.finalizar(ruta.id, req.user);
    res.json(await RutaModel.obtener(ruta.id));
  },

  /** Pasa un pedido pendiente a otra ruta del mismo día. { ruta_id } */
  async moverParada(req, res) {
    const { ruta_id: destinoId } = leerCampos(req.body, { ruta_id: { tipo: 'entero', requerido: true } }, { requeridos: true });
    const { origen, destino, pedidoId } = await RutaModel.moverParada(idParam(req.params.id), destinoId, req.user);
    const ref = pedidoId ? `Pedido #${pedidoId}` : 'Una parada';
    await notificar([origen.repartidor_id, origen.asistente_id], {
      tipo: 'pedido_retirado',
      titulo: `${ref} pasó a la Ruta ${destino.numero}`,
      cuerpo: `Ya no está en tu Ruta ${origen.numero}: no lo entregues (lo lleva la Ruta ${destino.numero}).`,
      datos: datosRuta(origen),
    }, { excepto: req.user.id });
    await notificar([destino.repartidor_id, destino.asistente_id], {
      tipo: 'ruta_modificada',
      titulo: `Ruta ${destino.numero}: se agregó ${ref.toLowerCase()}`,
      cuerpo: `Viene de la Ruta ${origen.numero}. Recógelo si aún lo tiene el otro equipo.`,
      datos: datosRuta(destino),
    }, { excepto: req.user.id });
    res.json(await RutaModel.obtener(destino.id));
  },

  async registrarPosicion(req, res) {
    const d = leerCampos(
      req.body,
      {
        lat: { tipo: 'coord', max: 90, requerido: true },
        lng: { tipo: 'coord', max: 180, requerido: true },
        precision: { tipo: 'monto' },
        velocidad: { tipo: 'monto' },
        rumbo: { tipo: 'monto' },
        ruta_id: { tipo: 'entero' },
      },
      { requeridos: true }
    );
    let rutaId = d.ruta_id;
    if (!rutaId) {
      // si la app no indica la ruta, se asocia a la ruta activa de hoy
      const rutas = await RutaModel.listar({ fecha: hoy(), repartidorId: req.user.id });
      rutaId = (rutas.find((r) => r.estado === 'en_curso') ?? rutas.find((r) => r.estado === 'planificada'))?.id;
    }
    await RutaModel.registrarPosicion({ usuario: req.user, ...d, rutaId });
    if (rutaId) {
      // seguimiento: llegada al almacén y camino restante (si falla, la posición igual quedó guardada)
      try {
        const pos = { lat: d.lat, lng: d.lng };
        if (!(await verificarLlegada(rutaId, pos, req.user))) await actualizarRestante(rutaId, pos);
      } catch (err) {
        console.error('Seguimiento de ruta:', err.message);
      }
    }
    res.status(204).end();
  },
};
