import { ESTADOS_PARADA, ESTADOS_RUTA } from '../config/catalogos.js';
import { PedidoModel } from '../models/pedido.model.js';
import { query } from '../config/db.js';
import { guardarEtas, paradasDe, RutaModel } from '../models/ruta.model.js';
import { RrhhModel } from '../models/rrhh.model.js';
import { etasAproximadas, horario, inicioRuta, ordenarConFranjas, repartir } from '../services/planificador.service.js';
import { modoViaje, trazarRuta } from '../services/rutas.service.js';
import { guardarFoto } from '../services/fotos.service.js';
import { actualizarRestante, reoptimizar, verificarLlegada } from '../services/seguimiento.service.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError, idParam } from '../utils/http.js';
import { soloEquipoRuta } from '../utils/roles.js';
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
  hora_salida: { tipo: 'hora' }, // hora planificada de salida del almacén (para las ETA)
};

/** Guarda las paradas de la ruta y avisa al equipo qué se agregó o quitó. */
async function guardarYAvisar(id, paradas, usuario) {
  const antes = await RutaModel.obtener(id);
  await RutaModel.guardarParadas(id, paradas, usuario);
  const ruta = await RutaModel.obtener(id);
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
    }, { excepto: usuario.id });
  }
  return ruta;
}

/**
 * Traza la ruta con Google y guarda la hora estimada de llegada a cada parada.
 * Con `optimizar` reordena las pendientes: si alguna tiene franja horaria se usa el planificador propio
 * (Google no conoce franjas) y Google traza ese orden; si no, optimiza Google como siempre.
 * Las paradas ya atendidas mantienen su lugar al inicio.
 */
async function trazarConEtas(id, optimizar, usuario) {
  const ruta = await RutaModel.obtener(id);
  if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
  const atendidas = ruta.paradas.filter((p) => p.estado !== 'pendiente');
  const pendientes = ruta.paradas.filter((p) => p.estado === 'pendiente');
  const modo = modoViaje(ruta.vehiculo_tipo);
  const ctx = { inicio: inicioRuta(ruta), fecha: ruta.fecha, tipo: ruta.vehiculo_tipo ?? 'auto' };
  let aTrazar = optimizar ? pendientes : ruta.paradas;
  let orden = null;
  let t;
  const conFranjas = optimizar && pendientes.length > 1 && pendientes.some((p) => p.franja_desde || p.franja_hasta);
  if (conFranjas) {
    aTrazar = ordenarConFranjas(pendientes, ctx);
    orden = [...atendidas, ...aTrazar].map((p) => p.id);
  }
  try {
    t = await trazarRuta(aTrazar, { optimizar: optimizar && !conFranjas, modo });
  } catch (err) {
    // sin Google (clave, cupo o red) la ruta queda en el orden calculado con horas aproximadas
    const h = etasAproximadas(aTrazar.filter((p) => p.estado === 'pendiente'), ctx);
    if (orden) await RutaModel.guardarTrazado(id, { orden, distanciaMetros: null, duracionSegundos: null, polyline: null, etas: { llegadas: h.llegadas, regreso: h.regreso } }, usuario);
    else await guardarEtasAprox(id, h);
    throw err;
  }
  if (optimizar && !conFranjas) {
    aTrazar = t.orden.map((i) => pendientes[i]);
    orden = [...atendidas, ...aTrazar].map((p) => p.id);
  }
  // horas estimadas con los tiempos reales de cada tramo según Google
  const h = horario(aTrazar, t.legs.map((l) => l.duracionSegundos), ctx);
  const pendientesIds = new Set(pendientes.map((p) => p.id));
  const llegadas = h.llegadas.filter((l) => pendientesIds.has(l.id));
  await RutaModel.guardarTrazado(id, { ...t, orden, etas: { llegadas, regreso: h.regreso } }, usuario);
  return RutaModel.obtener(id);
}

async function guardarEtasAprox(id, h) {
  await guardarEtas({ query }, id, h.llegadas);
  await query('UPDATE rutas SET regreso_estimado = $2 WHERE id = $1', [id, new Date(h.regreso)]);
}

const listaIds = (v, nombre) => {
  if (v == null) return null;
  if (!Array.isArray(v) || v.some((x) => !Number.isInteger(Number(x)) || Number(x) <= 0)) throw new HttpError(400, `${nombre} inválido`);
  return v.map(Number);
};

/** El chat de una ruta lo ven logística y el conductor/auxiliar asignados. */
async function rutaConAcceso(req) {
  const ruta = await RutaModel.obtener(idParam(req.params.id));
  if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
  const esEquipo = soloEquipoRuta(req.user);
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
    const delEquipo = soloEquipoRuta(req.user);
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
      asistenteId: d.asistente_id, estado: d.estado, horaSalida: d.hora_salida,
    }, req.user);
    // con otra hora de salida cambian las horas estimadas de llegada
    if ('hora_salida' in d && antes?.paradas.some((p) => p.estado === 'pendiente')) await trazarConEtas(id, false, req.user).catch(() => null);
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
    res.json(await guardarYAvisar(idParam(req.params.id), paradas, req.user));
  },

  /** Traza la ruta con Google; con { optimizar: true } también reordena las paradas pendientes (respetando franjas). */
  async trazar(req, res) {
    res.json(await trazarConEtas(idParam(req.params.id), req.body?.optimizar === true, req.user));
  },

  /**
   * Agrega pedidos a la ruta (desde el tablero: seleccionados en el mapa) y la vuelve a trazar.
   * { pedido_ids, optimizar = true }
   */
  async agregarPedidos(req, res) {
    const id = idParam(req.params.id);
    const ids = listaIds(req.body?.pedido_ids, 'pedido_ids');
    if (!ids?.length) throw new HttpError(400, 'Elige al menos un pedido');
    const ruta = await RutaModel.obtener(id);
    if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
    const enRuta = new Set(ruta.paradas.map((p) => p.pedido_id).filter(Boolean));
    const lista = [...ruta.paradas.map((p) => ({ id: p.id })), ...ids.filter((x) => !enRuta.has(x)).map((pedido_id) => ({ pedido_id }))];
    await guardarYAvisar(id, lista, req.user);
    // si Google no responde, los pedidos quedan en la ruta igual; se puede trazar después
    const trazada = await trazarConEtas(id, req.body?.optimizar !== false, req.user).catch((err) => ({ error: err.message }));
    if (trazada.error) return res.json({ ...(await RutaModel.obtener(id)), aviso: `Pedidos agregados, pero no se pudo trazar: ${trazada.error}` });
    return res.json(trazada);
  },

  /**
   * Reparte automáticamente los pedidos sin ruta del día entre las rutas planificadas:
   * cada pedido va donde menos alarga el recorrido, respetando franjas, el límite de 25 paradas,
   * la carga de cada ruta y la disponibilidad del conductor (sin vacaciones ni permisos aprobados).
   * { fecha, pedido_ids?, ruta_ids?, aplicar } — sin `aplicar` solo devuelve la propuesta.
   */
  async asignarAuto(req, res) {
    const { fecha } = leerCampos(req.body, { fecha: { tipo: 'fecha', requerido: true } }, { requeridos: true });
    const soloPedidos = listaIds(req.body?.pedido_ids, 'pedido_ids');
    const soloRutas = listaIds(req.body?.ruta_ids, 'ruta_ids');
    const aplicar = req.body?.aplicar === true;

    const ausencias = await RrhhModel.ausencias(fecha, fecha, { soloAprobadas: true }).catch(() => []);
    const ausentes = new Map(ausencias.filter((a) => a.usuario_id).map((a) => [a.usuario_id, a.tipo]));
    const todas = (await RutaModel.listar({ fecha })).filter((r) => r.estado === 'planificada' && (!soloRutas || soloRutas.includes(r.id)));
    const descartadas = todas.filter((r) => r.repartidor_id && ausentes.has(r.repartidor_id))
      .map((r) => ({ ruta_id: r.id, numero: r.numero, motivo: `${r.repartidor_nombre} tiene ${ausentes.get(r.repartidor_id).replace('_', ' ')} aprobado` }));
    const rutas = todas.filter((r) => !descartadas.some((d) => d.ruta_id === r.id));
    if (!rutas.length) {
      throw new HttpError(400, todas.length
        ? 'Los conductores de las rutas planificadas no están disponibles ese día'
        : 'No hay rutas planificadas ese día: crea las rutas (conductor y vehículo) y vuelve a intentar');
    }
    const paradas = await paradasDe(rutas.map((r) => r.id));
    const pedidos = (await PedidoModel.listar({ fecha, estado: 'pendiente', sinRuta: true }))
      .filter((p) => !soloPedidos || soloPedidos.includes(p.id));
    const sinUbicacion = pedidos.filter((p) => p.lat == null).map((p) => ({ pedido_id: p.id, cliente: p.cliente_nombre, motivo: 'sin ubicación en el mapa' }));
    const conUbicacion = pedidos.filter((p) => p.lat != null);
    if (!conUbicacion.length) throw new HttpError(400, pedidos.length ? 'Los pedidos sin ruta no tienen ubicación en el mapa' : 'No hay pedidos sin ruta ese día');

    const porPedido = new Map(conUbicacion.map((p) => [`pedido:${p.id}`, p]));
    const plan = repartir(
      rutas.map((r) => ({
        id: r.id, fecha: r.fecha, hora_salida: r.hora_salida, tipo: r.vehiculo_tipo ?? 'auto',
        paradas: paradas.filter((x) => x.ruta_id === r.id && x.estado === 'pendiente' && x.lat != null),
      })),
      conUbicacion.map((p) => ({
        id: `pedido:${p.id}`, pedido_id: p.id, lat: p.lat, lng: p.lng,
        franja_desde: p.franja_desde ? String(p.franja_desde).slice(0, 5) : null,
        franja_hasta: p.franja_hasta ? String(p.franja_hasta).slice(0, 5) : null,
      }))
    );
    const propuesta = rutas.map((r) => {
      const a = plan.asignaciones.get(r.id);
      const eta = new Map(a.llegadas.map((l) => [l.id, l]));
      return {
        ruta_id: r.id, numero: r.numero, conductor: r.repartidor_nombre, vehiculo: r.vehiculo_nombre, vehiculo_tipo: r.vehiculo_tipo,
        nuevos: a.paradas.filter((x) => String(x.id).startsWith('pedido:')).length,
        regreso_estimado: new Date(a.regreso).toISOString(),
        paradas: a.paradas.map((x) => {
          const nuevo = String(x.id).startsWith('pedido:');
          const p = nuevo ? porPedido.get(x.id) : x;
          const l = eta.get(x.id);
          return {
            nuevo, parada_id: nuevo ? null : x.id, pedido_id: nuevo ? p.id : x.pedido_id,
            cliente: nuevo ? p.cliente_nombre : x.titulo, distrito: p.distrito ?? null,
            franja: p.franja_desde || p.franja_hasta ? `${String(p.franja_desde ?? '').slice(0, 5)}–${String(p.franja_hasta ?? '').slice(0, 5)}` : null,
            eta: l ? new Date(l.eta).toISOString() : null, fuera_de_franja: l?.fuera_de_franja ?? false,
          };
        }),
      };
    });
    const sinAsignar = [...sinUbicacion, ...plan.sinAsignar.map((s) => {
      const p = porPedido.get(s.id);
      return { pedido_id: p.id, cliente: p.cliente_nombre, motivo: s.motivo };
    })];

    if (!aplicar) return res.json({ fecha, propuesta, sinAsignar, descartadas, aplicado: false });

    // aplicar: guarda el nuevo orden de cada ruta que recibe pedidos y la traza con Google (ETA reales)
    const resultados = [];
    for (const r of propuesta.filter((x) => x.nuevos > 0)) {
      const atendidas = paradas.filter((x) => x.ruta_id === r.ruta_id && x.estado !== 'pendiente').map((x) => ({ id: x.id }));
      const sinUbic = paradas.filter((x) => x.ruta_id === r.ruta_id && x.estado === 'pendiente' && x.lat == null).map((x) => ({ id: x.id }));
      const lista = [...atendidas, ...r.paradas.map((x) => (x.nuevo ? { pedido_id: x.pedido_id } : { id: x.parada_id })), ...sinUbic];
      try {
        await guardarYAvisar(r.ruta_id, lista, req.user);
        await trazarConEtas(r.ruta_id, true, req.user).catch((err) => { r.aviso = `no se pudo trazar: ${err.message}`; });
        resultados.push({ ruta_id: r.ruta_id, numero: r.numero, agregados: r.nuevos, aviso: r.aviso ?? null });
      } catch (err) {
        resultados.push({ ruta_id: r.ruta_id, numero: r.numero, agregados: 0, error: err.message });
      }
    }
    return res.json({ fecha, propuesta, sinAsignar, descartadas, aplicado: true, resultados });
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
    // hora real de la entrega cuando la app la guardó sin señal y la envía después
    let atendidaEn = null;
    if (req.body?.atendida_en) {
      const t = new Date(req.body.atendida_en);
      if (Number.isNaN(t.getTime())) throw new HttpError(400, 'atendida_en inválida');
      if (t.getTime() > Date.now() + 5 * 60_000 || t.getTime() < Date.now() - 7 * 86400_000) throw new HttpError(400, 'atendida_en fuera de rango');
      atendidaEn = t;
    }
    const rutaId = await RutaModel.atenderParada(paradaId, { estado, nota, usuario: req.user, atendidaEn });
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
