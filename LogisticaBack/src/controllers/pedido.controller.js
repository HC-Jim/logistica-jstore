import {
  AGENCIAS, COBRAR, ENVIAR_A, ESTADOS_PEDIDO, MEDIOS_PAGO, PAGO_AGENCIA, PLATAFORMAS, TIPOS_PEDIDO,
} from '../config/catalogos.js';
import { PedidoModel } from '../models/pedido.model.js';
import { leerCampos } from '../utils/campos.js';
import { hoy } from '../utils/fecha.js';
import { HttpError, idParam, requerir } from '../utils/http.js';

/** Campos del pedido (formulario de ingreso). */
const CAMPOS = {
  plataforma: { tipo: 'enum', lista: PLATAFORMAS, requerido: true },
  numero_pedido: { tipo: 'texto', max: 60 },
  documento_bsale: { tipo: 'texto', max: 40 },
  tipo_pedido: { tipo: 'enum', lista: TIPOS_PEDIDO, requerido: true },
  vendedor_id: { tipo: 'entero' },
  cliente_nombre: { tipo: 'texto', max: 160, requerido: true },
  cliente_telefono: { tipo: 'texto', max: 30 },
  agencia: { tipo: 'enum', lista: AGENCIAS },
  enviar_a: { tipo: 'enum', lista: ENVIAR_A },
  pago_agencia: { tipo: 'enum', lista: PAGO_AGENCIA },
  ubigeo: { tipo: 'ubigeo' },
  direccion: { tipo: 'texto', max: 255 },
  detalle_domicilio: { tipo: 'texto', max: 255 },
  referencia: { tipo: 'texto', max: 255 },
  cod_postal: { tipo: 'texto', max: 10 },
  link_ubicacion: { tipo: 'texto', max: 1000 },
  lat: { tipo: 'coord', max: 90 },
  lng: { tipo: 'coord', max: 180 },
  fecha_entrega: { tipo: 'fecha', requerido: true },
  precio_envio: { tipo: 'monto' },
  total_pedido: { tipo: 'monto' },
  cobrar: { tipo: 'enum', lista: COBRAR, requerido: true },
  medio_pago: { tipo: 'enum', lista: MEDIOS_PAGO },
  nota: { tipo: 'texto', max: 1000 },
};

const CAMPOS_ITEM = {
  producto_id: { tipo: 'entero', requerido: true },
  cantidad: { tipo: 'entero', requerido: true },
  precio_unitario: { tipo: 'monto' },
};

function leerItems(items) {
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) throw new HttpError(400, 'items debe ser una lista');
  return items.map((it) => leerCampos(it, CAMPOS_ITEM, { requeridos: true }));
}

function validarUbicacion(datos) {
  if (('lat' in datos || 'lng' in datos) && (datos.lat == null) !== (datos.lng == null)) {
    throw new HttpError(400, 'Envía lat y lng juntos');
  }
}

const FILTROS_FECHA = { fecha: { tipo: 'fecha' }, desde: { tipo: 'fecha' }, hasta: { tipo: 'fecha' } };

export const PedidoController = {
  async listar(req, res) {
    const { fecha, desde, hasta, estado, vendedor_id, plataforma, tipo_pedido, buscar, sin_ruta } = req.query;
    if (estado && estado.split(',').some((e) => !ESTADOS_PEDIDO.includes(e))) {
      throw new HttpError(400, 'Estado inválido');
    }
    res.json(await PedidoModel.listar({
      ...leerCampos({ fecha, desde, hasta }, FILTROS_FECHA),
      estado,
      plataforma,
      tipoPedido: tipo_pedido,
      buscar,
      sinRuta: sin_ruta === 'true',
      // el vendedor solo ve sus ventas
      vendedorId: req.user.rol === 'vendedor' ? req.user.id : vendedor_id && idParam(vendedor_id),
    }));
  },

  async obtener(req, res) {
    const pedido = await PedidoModel.obtener(idParam(req.params.id));
    if (!pedido) throw new HttpError(404, 'Pedido no encontrado');
    if (req.user.rol === 'vendedor' && pedido.vendedor_id !== req.user.id) {
      throw new HttpError(403, 'Este pedido no es tuyo');
    }
    res.json(pedido);
  },

  async crear(req, res) {
    const datos = leerCampos({ fecha_entrega: hoy(), cobrar: 'No Cobrar', ...req.body }, CAMPOS, { requeridos: true });
    validarUbicacion(datos);
    // El vendedor registra a su nombre; logística puede indicar el vendedor
    if (req.user.rol === 'vendedor' || !datos.vendedor_id) datos.vendedor_id = req.user.id;
    const id = await PedidoModel.crear({ datos, items: leerItems(req.body.items), usuario: req.user });
    res.status(201).json(await PedidoModel.obtener(id));
  },

  async actualizar(req, res) {
    const datos = leerCampos(req.body, CAMPOS);
    for (const campo of Object.keys(datos)) {
      if (CAMPOS[campo].requerido && datos[campo] == null) throw new HttpError(400, `${campo} es requerido`);
    }
    validarUbicacion(datos);
    // la fecha se cambia con "reprogramar" para dejar registro y sacar el pedido de su ruta
    delete datos.fecha_entrega;
    const id = idParam(req.params.id);
    await PedidoModel.actualizar(id, { datos, items: leerItems(req.body.items), usuario: req.user });
    res.json(await PedidoModel.obtener(id));
  },

  async cambiarEstado(req, res) {
    requerir(req.body, ['estado']);
    const id = idParam(req.params.id);
    await PedidoModel.cambiarEstado(id, { estado: req.body.estado, motivo: req.body.motivo, usuario: req.user });
    res.json(await PedidoModel.obtener(id));
  },

  async reprogramar(req, res) {
    const { fecha_entrega, motivo } = leerCampos(
      req.body,
      { fecha_entrega: { tipo: 'fecha', requerido: true }, motivo: { tipo: 'texto', max: 500 } },
      { requeridos: true }
    );
    const id = idParam(req.params.id);
    await PedidoModel.reprogramar(id, { fecha: fecha_entrega, motivo, usuario: req.user });
    res.json(await PedidoModel.obtener(id));
  },

  async observacionesAlmacen(req, res) {
    const { observaciones_almacen } = leerCampos(req.body, { observaciones_almacen: { tipo: 'texto', max: 1000 } });
    const id = idParam(req.params.id);
    await PedidoModel.observacionesAlmacen(id, { texto: observaciones_almacen ?? null, usuario: req.user });
    res.json(await PedidoModel.obtener(id));
  },
};
