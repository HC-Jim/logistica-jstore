// Listas de valores seleccionables del formulario de pedidos.
// Para agregar una opción basta con añadirla aquí: la API la valida y el frontend la muestra.

export const PLATAFORMAS = [
  'Marketplace', 'Mercado Libre', 'Móvil', 'Juntoz', 'Ripley', 'RRSS', 'Shopstar', 'Web', 'Claro', 'Log. Inversa',
];

export const TIPOS_PEDIDO = [
  'Agencia', 'Delivery', 'Flex', 'Olva Juntoz', 'Ripley Agencia', 'Ripley Delivery', 'Shopstar Urbano', 'Cambio',
  'Entrega Pza Faltante', 'Entrega S.T', 'Recojo S.T', 'Claro Agencia', 'Claro Delivery',
];

export const AGENCIAS = [
  'Cruz del Sur', 'Marvisur', 'Móvil Bus', 'Oltursa', 'Olva Courier', 'Scharff', 'Shalom', 'Urbano', 'Otras',
];

export const ENVIAR_A = ['Sede de Agencia', 'Domicilio de Agencia'];

export const PAGO_AGENCIA = ['Pago destino', 'Pago envío'];

export const COBRAR = ['No Cobrar', 'Cobrar Productos', 'Cobrar Envío', 'Cobrar Total'];

export const MEDIOS_PAGO = [
  'Efectivo', 'BCP', 'Interbank', 'Link Pago', 'ML Pago', 'Web Pago', 'Plin', 'POS', 'Yape', 'Otros',
  'BBVA Jhon', 'Scotiabank Jhon',
];

// Ciclo de vida del pedido:
// pendiente (sin rutear) → ruteado (está en una ruta) → entregado
//                                     └→ incidencia (no se pudo entregar) → se reprograma → pendiente
// cualquiera salvo entregado → cancelado
export const ESTADOS_PEDIDO = ['pendiente', 'ruteado', 'entregado', 'incidencia', 'cancelado'];

export const ROLES = ['admin', 'vendedor', 'planificador', 'almacen', 'repartidor'];

export const ESTADOS_RUTA = ['planificada', 'en_curso', 'finalizada'];
export const ESTADOS_PARADA = ['pendiente', 'completada', 'incidencia'];

export const catalogos = {
  plataformas: PLATAFORMAS,
  tiposPedido: TIPOS_PEDIDO,
  agencias: AGENCIAS,
  enviarA: ENVIAR_A,
  pagoAgencia: PAGO_AGENCIA,
  cobrar: COBRAR,
  mediosPago: MEDIOS_PAGO,
  estadosPedido: ESTADOS_PEDIDO,
  roles: ROLES,
};
