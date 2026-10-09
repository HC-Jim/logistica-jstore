// Listas de valores seleccionables del formulario de pedidos.
// Para agregar una opción basta con añadirla aquí: la API la valida y el frontend la muestra.

// Plataformas de venta. "Log. Inversa" e "Interno" las asigna el sistema según la categoría.
export const PLATAFORMAS_VENTA = [
  'Marketplace', 'Mercado Libre', 'Móvil', 'Juntoz', 'Ripley', 'RRSS', 'Shopstar', 'Web', 'Claro',
];
export const PLATAFORMA_INVERSA = 'Log. Inversa';
export const PLATAFORMA_ENCARGO = 'Interno';
export const PLATAFORMAS = [...PLATAFORMAS_VENTA, PLATAFORMA_INVERSA, PLATAFORMA_ENCARGO];

// Tres formas de registrar: venta, logística inversa y encargo logístico
export const CATEGORIAS = ['venta', 'inversa', 'encargo'];

export const TIPOS_VENTA = [
  'Agencia', 'Delivery', 'Flex', 'Olva Juntoz', 'Ripley Agencia', 'Ripley Delivery', 'Shopstar Urbano',
  'Claro Agencia', 'Claro Delivery',
];

// Logística inversa: recojos y entregas de servicio técnico, piezas y cambios
export const TIPOS_INVERSA = ['Recojo S.T', 'Entrega S.T', 'Entrega Pza Faltante', 'Cambio'];
export const MOTIVOS_INVERSA = [
  'Garantía / servicio técnico', 'Pieza faltante', 'Error de despacho', 'Cambio de producto', 'Devolución', 'Otro',
];

// Encargos logísticos: no son ventas, pero se planifican en las rutas
export const TIPOS_ENCARGO = [
  'Entrega a almacén externo', 'Recojo de suministros', 'Traslado entre almacenes', 'Otro encargo',
];

// Tipos en los que el conductor RECOGE (en vez de entregar)
export const TIPOS_RECOJO = ['Recojo S.T', 'Recojo de suministros'];

export const TIPOS_PEDIDO = [...TIPOS_VENTA, ...TIPOS_INVERSA, ...TIPOS_ENCARGO];
export const TIPOS_POR_CATEGORIA = { venta: TIPOS_VENTA, inversa: TIPOS_INVERSA, encargo: TIPOS_ENCARGO };

export const TIPOS_UBICACION = ['almacen_propio', 'almacen_externo', 'proveedor', 'agencia', 'cliente', 'otro'];

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

// 'repartidor' es el Conductor de la ruta; 'auxiliar' es el Auxiliar logístico que lo acompaña
export const ROLES = ['admin', 'vendedor', 'planificador', 'almacen', 'repartidor', 'auxiliar'];

export const ESTADOS_RUTA = ['planificada', 'en_curso', 'finalizada'];

// Rutas que se muestran cada día (Ruta 1, 2, 3). Se pueden abrir más según la demanda.
export const RUTAS_POR_DEFECTO = 3;

export const TIPOS_VEHICULO = ['auto', 'moto', 'bicicleta', 'furgoneta', 'otro'];
export const ESTADOS_PARADA = ['pendiente', 'completada', 'incidencia', 'cancelada'];

export const catalogos = {
  plataformas: PLATAFORMAS_VENTA,
  tiposPedido: TIPOS_PEDIDO,
  tiposPorCategoria: TIPOS_POR_CATEGORIA,
  motivosInversa: MOTIVOS_INVERSA,
  tiposRecojo: TIPOS_RECOJO,
  tiposUbicacion: TIPOS_UBICACION,
  agencias: AGENCIAS,
  enviarA: ENVIAR_A,
  pagoAgencia: PAGO_AGENCIA,
  cobrar: COBRAR,
  mediosPago: MEDIOS_PAGO,
  estadosPedido: ESTADOS_PEDIDO,
  roles: ROLES,
  rutasPorDefecto: RUTAS_POR_DEFECTO,
  tiposVehiculo: TIPOS_VEHICULO,
};
