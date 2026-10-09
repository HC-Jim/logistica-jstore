import {
  AGENCIAS, CATEGORIAS, COBRAR, ENVIAR_A, ESTADOS_PEDIDO, MEDIOS_PAGO, MOTIVOS_INVERSA, PAGO_AGENCIA,
  PLATAFORMA_ENCARGO, PLATAFORMA_INVERSA, PLATAFORMAS, PLATAFORMAS_VENTA, TIPOS_PEDIDO, TIPOS_POR_CATEGORIA,
} from '../config/catalogos.js';
import { PedidoModel } from '../models/pedido.model.js';
import { RutaModel } from '../models/ruta.model.js';
import { notificar } from '../services/notificaciones.service.js';
import { UbicacionModel } from '../models/ubicacion.model.js';
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
  // logística inversa
  motivo: { tipo: 'enum', lista: MOTIVOS_INVERSA },
  pedido_relacionado: { tipo: 'texto', max: 60 },
  // encargos: punto frecuente de destino y, en traslados, de origen
  ubicacion_id: { tipo: 'entero' },
  origen_ubicacion_id: { tipo: 'entero' },
};

const CAMPOS_ITEM = {
  producto_id: { tipo: 'entero' },               // del catálogo…
  descripcion: { tipo: 'texto', max: 255 },      // …o pieza/producto libre (inversa y encargos)
  cantidad: { tipo: 'entero', requerido: true },
  precio_unitario: { tipo: 'monto' },
};

function leerItems(items) {
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) throw new HttpError(400, 'items debe ser una lista');
  return items.map((it) => leerCampos(it, CAMPOS_ITEM, { requeridos: true }));
}

// Quién puede registrar cada categoría
const PUEDE_CREAR = {
  venta: ['admin', 'planificador', 'vendedor'],
  inversa: ['admin', 'planificador', 'vendedor'],
  encargo: ['admin', 'planificador', 'almacen'],
};

/** Ajusta y valida los datos según la categoría (plataforma fija, tipos permitidos, motivo…). */
async function aplicarCategoria(categoria, body) {
  const b = { ...body };
  if (categoria === 'inversa') b.plataforma = PLATAFORMA_INVERSA;
  if (categoria === 'encargo') {
    b.plataforma = PLATAFORMA_ENCARGO;
    b.cobrar = 'No Cobrar';
    // un punto frecuente completa destino, dirección y ubicación en el mapa
    if (b.ubicacion_id) {
      const u = await UbicacionModel.obtener(idParam(b.ubicacion_id));
      if (!u) throw new HttpError(400, 'La ubicación frecuente no existe');
      b.cliente_nombre ||= u.nombre;
      b.cliente_telefono ||= u.telefono;
      b.direccion ||= u.direccion;
      b.referencia ||= u.referencia;
      b.ubigeo ||= u.ubigeo;
      if (b.lat == null || b.lat === '') { b.lat = u.lat; b.lng = u.lng; }
    }
  }
  // Envío por agencia: el conductor deja el paquete en una sede de la agencia (en Lima)
  if (categoria !== 'encargo' && b.ubicacion_id) {
    const u = await UbicacionModel.obtener(idParam(b.ubicacion_id));
    if (!u || u.tipo !== 'agencia') throw new HttpError(400, 'Elige una sede de agencia registrada en Ubicaciones');
    if (b.lat == null || b.lat === '') { b.lat = u.lat; b.lng = u.lng; }
  }
  if (categoria === 'venta' && b.plataforma && !PLATAFORMAS_VENTA.includes(b.plataforma)) {
    throw new HttpError(400, 'Esa plataforma no corresponde a una venta');
  }
  if (b.tipo_pedido && !TIPOS_POR_CATEGORIA[categoria].includes(b.tipo_pedido)) {
    throw new HttpError(400, `Tipo inválido. Opciones: ${TIPOS_POR_CATEGORIA[categoria].join(', ')}`);
  }
  if (categoria === 'inversa' && !b.motivo) throw new HttpError(400, 'Indica el motivo de la logística inversa');
  return b;
}

function validarUbicacion(datos) {
  if (('lat' in datos || 'lng' in datos) && (datos.lat == null) !== (datos.lng == null)) {
    throw new HttpError(400, 'Envía lat y lng juntos');
  }
}

const FILTROS_FECHA = { fecha: { tipo: 'fecha' }, desde: { tipo: 'fecha' }, hasta: { tipo: 'fecha' } };

// Cambios que el conductor debe conocer si el pedido ya está en su ruta
const CAMPOS_AVISO = {
  direccion: 'dirección', detalle_domicilio: 'detalle', referencia: 'referencia', lat: 'ubicación',
  cliente_telefono: 'teléfono', cobrar: 'cobro', total_pedido: 'total', medio_pago: 'medio de pago', nota: 'nota',
};

/** Avisa al equipo de la ruta donde estaba el pedido (si estaba en una pendiente de atender). */
async function avisarRuta(antes, aviso, usuario) {
  if (!antes?.ruta_id || antes.parada_estado !== 'pendiente') return;
  const ruta = await RutaModel.obtener(antes.ruta_id);
  if (!ruta) return;
  await notificar([ruta.repartidor_id, ruta.asistente_id], {
    ...aviso,
    url: `/rutas/${ruta.id}`,
    datos: { ruta_id: ruta.id, fecha: ruta.fecha, pedido_id: antes.id },
  }, { excepto: usuario.id });
}

export const PedidoController = {
  async listar(req, res) {
    const { fecha, desde, hasta, estado, vendedor_id, plataforma, tipo_pedido, buscar, sin_ruta, categoria } = req.query;
    if (categoria && categoria.split(',').some((c) => !CATEGORIAS.includes(c))) throw new HttpError(400, 'Categoría inválida');
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
      categoria,
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
    const categoria = req.body.categoria || 'venta';
    if (!CATEGORIAS.includes(categoria)) throw new HttpError(400, 'Categoría inválida');
    if (!PUEDE_CREAR[categoria].includes(req.user.rol)) {
      throw new HttpError(403, 'No puedes registrar este tipo de pedido');
    }
    const body = await aplicarCategoria(categoria, { fecha_entrega: hoy(), cobrar: 'No Cobrar', ...req.body });
    const datos = leerCampos(body, CAMPOS, { requeridos: true });
    datos.categoria = categoria;
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
    const antes = await PedidoModel.obtener(id);
    await PedidoModel.actualizar(id, { datos, items: leerItems(req.body.items), usuario: req.user });
    const despues = await PedidoModel.obtener(id);
    const cambiados = Object.keys(CAMPOS_AVISO).filter((c) => antes && String(antes[c] ?? '') !== String(despues[c] ?? ''));
    if (cambiados.length) {
      await avisarRuta(antes, {
        tipo: 'pedido_modificado',
        titulo: `Pedido #${id} modificado (Ruta ${antes.ruta_numero})`,
        cuerpo: `${despues.cliente_nombre}: cambió ${cambiados.map((c) => CAMPOS_AVISO[c]).join(', ')}`,
      }, req.user);
    }
    res.json(despues);
  },

  async cambiarEstado(req, res) {
    requerir(req.body, ['estado']);
    const id = idParam(req.params.id);
    const antes = await PedidoModel.obtener(id);
    await PedidoModel.cambiarEstado(id, { estado: req.body.estado, motivo: req.body.motivo, usuario: req.user });
    if (['cancelado', 'pendiente'].includes(req.body.estado)) {
      await avisarRuta(antes, {
        tipo: 'pedido_retirado',
        titulo: `Pedido #${id} retirado de la Ruta ${antes?.ruta_numero}`,
        cuerpo: `${antes?.cliente_nombre}: ${req.body.estado === 'cancelado' ? `cancelado${req.body.motivo ? ` (${req.body.motivo})` : ''}` : 'vuelve a pendiente'}. No lo entregues.`,
      }, req.user);
    }
    res.json(await PedidoModel.obtener(id));
  },

  async reprogramar(req, res) {
    const { fecha_entrega, motivo } = leerCampos(
      req.body,
      { fecha_entrega: { tipo: 'fecha', requerido: true }, motivo: { tipo: 'texto', max: 500 } },
      { requeridos: true }
    );
    const id = idParam(req.params.id);
    const antes = await PedidoModel.obtener(id);
    await PedidoModel.reprogramar(id, { fecha: fecha_entrega, motivo, usuario: req.user });
    await avisarRuta(antes, {
      tipo: 'pedido_retirado',
      titulo: `Pedido #${id} retirado de la Ruta ${antes?.ruta_numero}`,
      cuerpo: `${antes?.cliente_nombre}: reprogramado al ${fecha_entrega.slice(8, 10)}/${fecha_entrega.slice(5, 7)}${motivo ? ` (${motivo})` : ''}. No lo entregues hoy.`,
    }, req.user);
    res.json(await PedidoModel.obtener(id));
  },

  async observacionesAlmacen(req, res) {
    const { observaciones_almacen } = leerCampos(req.body, { observaciones_almacen: { tipo: 'texto', max: 1000 } });
    const id = idParam(req.params.id);
    await PedidoModel.observacionesAlmacen(id, { texto: observaciones_almacen ?? null, usuario: req.user });
    res.json(await PedidoModel.obtener(id));
  },
};
