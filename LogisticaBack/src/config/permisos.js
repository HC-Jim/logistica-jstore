// Quién puede hacer qué. Las rutas usan requireRol(...PERMISOS.x).

export const PERMISOS = {
  verPedidos: ['admin', 'planificador', 'almacen', 'vendedor'], // el vendedor solo ve los suyos
  crearPedido: ['admin', 'planificador', 'vendedor', 'almacen'], // almacén: solo encargos (se valida por categoría)
  editarPedido: ['admin', 'planificador', 'vendedor', 'almacen'], // vendedor: algunos campos de sus ventas; almacén: encargos
  gestionarEstado: ['admin', 'planificador'],
  reprogramar: ['admin', 'planificador', 'vendedor'],
  observacionesAlmacen: ['admin', 'planificador', 'almacen'],
  gestionarRutas: ['admin', 'planificador'],
  despacho: ['admin', 'planificador', 'almacen'], // hoja de ruta y entrega de pedidos al conductor
  monitoreo: ['admin', 'planificador', 'almacen'],
  verProductos: ['admin', 'planificador', 'vendedor', 'almacen'],
  gestionarProductos: ['admin', 'planificador'],
  estadisticas: ['admin', 'planificador'],
  usuarios: ['admin'],
  appRepartidor: ['repartidor', 'auxiliar'], // conductor y auxiliar logístico
  // el chat lo usan logística y el equipo de la ruta (se valida que la ruta sea suya)
  chatRuta: ['admin', 'planificador', 'almacen', 'repartidor', 'auxiliar'],
};

/** Campos que un vendedor puede modificar en sus propias ventas. */
export const CAMPOS_VENDEDOR = new Set([
  'cliente_nombre', 'cliente_telefono', 'agencia', 'enviar_a', 'pago_agencia', 'ubigeo',
  'direccion', 'detalle_domicilio', 'referencia', 'cod_postal',
  // la ubicación en el mapa acompaña a la dirección
  'link_ubicacion', 'lat', 'lng',
  'ubicacion_id', // sede de la agencia cuando el envío es por agencia
  'precio_envio', 'total_pedido', 'cobrar', 'medio_pago', 'nota',
]);

/** Estados en los que el pedido todavía se puede modificar. */
export const ESTADOS_EDITABLES = ['pendiente', 'ruteado', 'incidencia'];
