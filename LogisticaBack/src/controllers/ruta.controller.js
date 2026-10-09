import { ESTADOS_PARADA, ESTADOS_RUTA } from '../config/catalogos.js';
import { PedidoModel } from '../models/pedido.model.js';
import { paradasDe, RutaModel } from '../models/ruta.model.js';
import { trazarRuta } from '../services/rutas.service.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError, idParam } from '../utils/http.js';
import { env } from '../config/env.js';

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
    const id = await RutaModel.finalizar(idParam(req.params.id));
    res.json(await RutaModel.obtener(id));
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
    res.status(201).json(await RutaModel.obtener(id));
  },

  async actualizar(req, res) {
    const d = leerCampos(req.body, CAMPOS_RUTA);
    const id = idParam(req.params.id);
    if (d.estado === 'finalizada') throw new HttpError(400, 'Usa "Finalizar ruta" para cerrarla');
    await RutaModel.actualizar(id, {
      nombre: d.nombre, vehiculoId: d.vehiculo_id, repartidorId: d.repartidor_id,
      asistenteId: d.asistente_id, estado: d.estado,
    });
    res.json(await RutaModel.obtener(id));
  },

  async eliminar(req, res) {
    await RutaModel.eliminar(idParam(req.params.id), req.user);
    res.status(204).end();
  },

  async guardarParadas(req, res) {
    if (!Array.isArray(req.body?.paradas)) throw new HttpError(400, 'Envía { paradas: [...] }');
    const paradas = req.body.paradas.map((p) => leerCampos(p, CAMPOS_PARADA));
    const id = idParam(req.params.id);
    await RutaModel.guardarParadas(id, paradas, req.user);
    res.json(await RutaModel.obtener(id));
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
    const t = await trazarRuta(aTrazar, { optimizar });
    const orden = optimizar
      ? [...atendidas.map((p) => p.id), ...t.orden.map((i) => pendientes[i].id)]
      : null;
    await RutaModel.guardarTrazado(id, { ...t, orden });
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
    res.json({ fecha, deposito: env.deposito, rutas, sinRuta, generado: new Date().toISOString() });
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
    if (ruta.estado === 'planificada') await RutaModel.actualizar(id, { estado: 'en_curso' });
    res.json(await RutaModel.obtener(id));
  },

  async atenderParada(req, res) {
    const { estado, nota } = leerCampos(
      req.body,
      { estado: { tipo: 'enum', lista: ESTADOS_PARADA.filter((e) => e !== 'pendiente'), requerido: true }, nota: { tipo: 'texto', max: 1000 } },
      { requeridos: true }
    );
    const rutaId = await RutaModel.atenderParada(idParam(req.params.id), { estado, nota, usuario: req.user });
    res.json(await RutaModel.obtener(rutaId));
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
    res.status(204).end();
  },
};
