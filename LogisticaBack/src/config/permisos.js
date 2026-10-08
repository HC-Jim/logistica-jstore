// Quién puede hacer qué. Las rutas usan requireRol(...PERMISOS.x).

export const PERMISOS = {
  verPedidos: ['admin', 'planificador', 'almacen', 'vendedor'], // el vendedor solo ve los suyos
  crearPedido: ['admin', 'planificador', 'vendedor'],
  editarPedido: ['admin', 'planificador', 'vendedor'], // el vendedor solo algunos campos de sus ventas
  gestionarEstado: ['admin', 'planificador'],
  reprogramar: ['admin', 'planificador', 'vendedor'],
  observacionesAlmacen: ['admin', 'planificador', 'almacen'],
  gestionarRutas: ['admin', 'planificador'],
  monitoreo: ['admin', 'planificador', 'almacen'],
  verProductos: ['admin', 'planificador', 'vendedor', 'almacen'],
  gestionarProductos: ['admin', 'planificador'],
  estadisticas: ['admin', 'planificador'],
  usuarios: ['admin'],
  appRepartidor: ['repartidor', 'auxiliar'], // conductor y auxiliar logístico
};

/** Campos que un vendedor puede modificar en sus propias ventas. */
export const CAMPOS_VENDEDOR = new Set([
  'cliente_nombre', 'cliente_telefono', 'agencia', 'enviar_a', 'pago_agencia', 'ubigeo',
  'direccion', 'detalle_domicilio', 'referencia', 'cod_postal',
  // la ubicación en el mapa acompaña a la dirección
  'link_ubicacion', 'lat', 'lng',
  'precio_envio', 'total_pedido', 'cobrar', 'medio_pago', 'nota',
]);

/** Estados en los que el pedido todavía se puede modificar. */
export const ESTADOS_EDITABLES = ['pendiente', 'ruteado', 'incidencia'];
