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
// vendedor = Comercial · planificador = Administrador Logístico · catalogo = Administrador de Catálogo
// rrhh = Administrador de RRHH · jefe = Jefe de área (aprueba a su equipo) · colaborador = solo su espacio de RRHH
export const ROLES = ['admin', 'vendedor', 'planificador', 'almacen', 'repartidor', 'auxiliar', 'catalogo', 'rrhh', 'jefe', 'colaborador'];

export const ESTADOS_RUTA = ['planificada', 'en_curso', 'finalizada'];

// Rutas que se muestran cada día (Ruta 1, 2, 3). Se pueden abrir más según la demanda.
export const RUTAS_POR_DEFECTO = 3;

// --- Módulo Productos ---
export const TIPOS_PRODUCTO = ['Ítem único', 'Variante', 'Combo', 'Servicio'];
export const ESTADOS_SOURCING = ['En Evaluación', 'Comprado / En Tránsito', 'Línea Regular (Resurtible)', 'Descontinuado'];
export const ESTADOS_VERIFICACION = ['Pendiente de Arribo', 'Recibido - Por Medir', 'Medido y Verificado', 'Inactivo'];
// Plataformas donde se publica precio (módulo Precios); Efe solo queda en el historial
export const PLATAFORMAS_PRECIO = ['Web', 'Coolbox', 'Diners', 'Yape', 'Falabella', 'Juntoz', 'Mercado L.', 'Rappi', 'Intercorp', 'Ripley', 'Shopstar', 'Claro'];
export const TIPOS_CLIENTE = ['Común / Final', 'Empresa', 'Mayorista'];
export const SEGMENTOS_MARCA = ['Core', 'Growth', 'Traffic', 'Profit', 'Volume'];

export const TIPOS_VEHICULO = ['auto', 'moto', 'bicicleta', 'furgoneta', 'a_pie', 'transporte_publico', 'otro'];
// Movilidades que pueden usar varias rutas el mismo día (no son un vehículo físico)
export const MOVILIDAD_COMPARTIDA = ['a_pie', 'transporte_publico'];
export const ESTADOS_PARADA = ['pendiente', 'completada', 'incidencia', 'cancelada'];

// --- Módulo Recursos Humanos ---
export const AREAS = ['Gerencia', 'Administración', 'Comercial', 'Logística', 'Almacén', 'Catálogo', 'Recursos Humanos', 'Otro'];
export const TIPOS_DOCUMENTO_IDENTIDAD = ['DNI', 'CE', 'Pasaporte', 'PTP'];
export const TIPOS_CONTRATO = ['Plazo indeterminado', 'Plazo fijo', 'Tiempo parcial', 'Prácticas', 'Locación de servicios'];
export const SISTEMAS_PENSION = ['ONP', 'AFP', 'Sin sistema'];
export const AFPS = ['Habitat', 'Integra', 'Prima', 'Profuturo'];
export const BANCOS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'BanBif', 'Pichincha', 'Otro'];
export const CATEGORIAS_LICENCIA = ['A-I', 'A-IIa', 'A-IIb', 'A-IIIa', 'A-IIIb', 'A-IIIc', 'B-I', 'B-IIa', 'B-IIb', 'B-IIc'];
export const TIPOS_DOCUMENTO_RRHH = [
  'Contrato', 'Adenda', 'DNI', 'Licencia de conducir', 'Antecedentes', 'Examen médico', 'SCTR', 'CV',
  'Certificado médico', 'Constancia', 'Otro',
];
// Solicitudes: vacaciones, permisos, descansos médicos y licencias (paternidad, fallecimiento…)
export const TIPOS_SOLICITUD = ['vacaciones', 'permiso', 'descanso_medico', 'licencia'];
export const ESTADOS_SOLICITUD = ['pendiente', 'aprobada', 'rechazada', 'anulada'];
// Remuneración mínima vital (asignación familiar = 10 %) y aporte de EsSalud del empleador
export const RMV = 1130;
export const TASA_ESSALUD = 0.09;
// Días de vacaciones por año completo de servicio (D. Leg. 713)
export const DIAS_VACACIONES_ANIO = 30;

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
  tiposProducto: TIPOS_PRODUCTO,
  estadosSourcing: ESTADOS_SOURCING,
  estadosVerificacion: ESTADOS_VERIFICACION,
  segmentosMarca: SEGMENTOS_MARCA,
  plataformasPrecio: PLATAFORMAS_PRECIO,
  tiposCliente: TIPOS_CLIENTE,
  areas: AREAS,
  tiposDocumentoIdentidad: TIPOS_DOCUMENTO_IDENTIDAD,
  tiposContrato: TIPOS_CONTRATO,
  sistemasPension: SISTEMAS_PENSION,
  afps: AFPS,
  bancos: BANCOS,
  categoriasLicencia: CATEGORIAS_LICENCIA,
  tiposDocumentoRrhh: TIPOS_DOCUMENTO_RRHH,
  tiposSolicitud: TIPOS_SOLICITUD,
  rmv: RMV,
};
