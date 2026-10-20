import express, { Router } from 'express';
import { PERMISOS as P } from '../config/permisos.js';
import { AuthController } from '../controllers/auth.controller.js';
import { BsaleController } from '../controllers/bsale.controller.js';
import { CatalogoController } from '../controllers/catalogo.controller.js';
import { NotificacionController } from '../controllers/notificacion.controller.js';
import { ReporteController } from '../controllers/reporte.controller.js';
import { RrhhController as RH } from '../controllers/rrhh.controller.js';
import { PrecioController } from '../controllers/precio.controller.js';
import { PanelController } from '../controllers/panel.controller.js';
import { PedidoController } from '../controllers/pedido.controller.js';
import { ProductoController } from '../controllers/producto.controller.js';
import { RutaController } from '../controllers/ruta.controller.js';
import { UbicacionController } from '../controllers/ubicacion.controller.js';
import { VehiculoController } from '../controllers/vehiculo.controller.js';
import { requireAuth, requireRol as rol } from '../middlewares/auth.js';

const router = Router();

// --- Autenticación (web y app del repartidor) ---
router.post('/auth/login', AuthController.login);
router.post('/auth/registro', AuthController.registro);

router.use(requireAuth); // todo lo de abajo requiere sesión

router.get('/auth/perfil', AuthController.perfil);

// --- Notificaciones (cualquier usuario con sesión: solo las suyas) ---
router.get('/notificaciones', NotificacionController.listar);
router.get('/notificaciones/contador', NotificacionController.contador);
router.post('/notificaciones/leer', NotificacionController.marcarLeidas);
router.post('/dispositivos', NotificacionController.registrarDispositivo);
router.delete('/dispositivos', NotificacionController.quitarDispositivo);

// --- Catálogos ---
router.get('/catalogos', CatalogoController.catalogos);
router.get('/ubigeos', CatalogoController.ubigeos);
router.post('/ubicacion/resolver', CatalogoController.resolverUbicacion);

// --- Usuarios ---
// la lista (p. ej. ?rol=repartidor) la usa logística para asignar rutas
router.get('/usuarios', rol('admin', 'planificador', 'rrhh'), AuthController.listarUsuarios);
router.post('/usuarios', rol(...P.usuarios), AuthController.crearUsuario);
router.put('/usuarios/:id', rol(...P.usuarios), AuthController.actualizarUsuario);
router.post('/usuarios/:id/aprobar', rol(...P.usuarios), AuthController.aprobarUsuario);
router.delete('/usuarios/:id', rol(...P.usuarios), AuthController.rechazarUsuario);

// --- Productos ---
// --- Dashboards de Productos y Precios ---
router.get('/productos/dashboard', rol(...P.verProductos), PanelController.productos);
router.get('/precios/dashboard', rol(...P.verPrecios), PanelController.precios);

// Bsale: lectura, diferencias y envío de productos y precios
router.get('/bsale/estado', rol(...P.gestionarPrecios), BsaleController.estado);
router.put('/bsale/listas', rol(...P.gestionarPrecios), BsaleController.guardarListas);
router.post('/bsale/leer/:paso', rol(...P.gestionarPrecios), BsaleController.leer);
router.get('/bsale/diferencias', rol(...P.gestionarPrecios), BsaleController.diferencias);
router.post('/bsale/precios', rol(...P.gestionarPrecios), BsaleController.enviarPrecios);
router.post('/bsale/productos', rol(...P.gestionarProductos), BsaleController.crear);
router.post('/bsale/nombres', rol(...P.gestionarProductos), BsaleController.nombres);
router.get('/bsale/catalogo', rol(...P.gestionarProductos), BsaleController.productos);
router.get('/bsale/estado-catalogo', rol(...P.verProductos), BsaleController.estadoCatalogo);
router.post('/bsale/categorias', rol(...P.gestionarProductos), BsaleController.crearCategorias);
router.post('/bsale/fichas', rol(...P.gestionarProductos), BsaleController.fichas);
router.get('/bsale/envios', rol(...P.gestionarPrecios), BsaleController.envios);

// --- Precios ---
router.get('/precios/plataformas', rol(...P.verPrecios), PrecioController.plataformas);
router.get('/precios/vigentes', rol(...P.verPrecios), PrecioController.vigentes);
router.get('/precios/descuentos', rol(...P.verPrecios), PrecioController.descuentos);
router.put('/precios/descuentos', rol(...P.gestionarPrecios), PrecioController.guardarDescuentos);
router.get('/precios/producto/:id', rol(...P.verPrecios), PrecioController.historial);
router.get('/precios/producto/:id/bsale', rol(...P.verPrecios), PrecioController.bsaleDeProducto);
router.get('/precios/listas-bsale', rol(...P.verPrecios), PrecioController.listasBsale);
router.post('/precios/importar', rol(...P.gestionarPrecios), PrecioController.importar);
router.post('/precios', rol(...P.gestionarPrecios), PrecioController.registrar);
router.delete('/precios/:id', rol(...P.gestionarPrecios), PrecioController.eliminar);

router.get('/productos', rol(...P.verProductos), ProductoController.listar);
router.get('/productos/reclasificar', rol(...P.gestionarProductos), ProductoController.gruposAnteriores);
router.post('/productos/reclasificar', rol(...P.gestionarProductos), ProductoController.reclasificar);
router.get('/productos/matriz', rol(...P.verProductos), ProductoController.matriz);
router.post('/productos/categorias', rol(...P.gestionarProductos), ProductoController.guardarCategoria);
router.put('/productos/categorias/:id', rol(...P.gestionarProductos), ProductoController.guardarCategoria);
router.post('/productos/subcategorias', rol(...P.gestionarProductos), ProductoController.guardarSubcategoria);
router.put('/productos/subcategorias/:id', rol(...P.gestionarProductos), ProductoController.guardarSubcategoria);
router.get('/productos/marcas', rol(...P.verProductos), ProductoController.marcas);
router.post('/productos/marcas', rol(...P.gestionarProductos), ProductoController.guardarMarca);
router.put('/productos/marcas/:id', rol(...P.gestionarProductos), ProductoController.guardarMarca);
router.get('/productos/proponer-sku', rol(...P.gestionarProductos), ProductoController.proponerSku);
router.get('/productos/:id', rol(...P.verProductos), ProductoController.obtener);
router.put('/productos/:id/componentes', rol(...P.gestionarProductos), ProductoController.guardarComponentes);
router.post('/productos/importar', rol(...P.gestionarProductos), ProductoController.importar);
router.post('/productos', rol(...P.gestionarProductos), ProductoController.crear);
router.put('/productos/:id', rol(...P.gestionarProductos), ProductoController.actualizar);
router.delete('/productos/:id', rol(...P.gestionarProductos), ProductoController.eliminar);

// --- Pedidos ---
router.get('/pedidos', rol(...P.verPedidos), PedidoController.listar);
router.post('/pedidos', rol(...P.crearPedido), PedidoController.crear);
router.post('/pedidos/importar', rol(...P.crearPedido), PedidoController.importar);
router.get('/pedidos/plantilla', rol(...P.crearPedido), PedidoController.plantilla);
router.get('/pedidos/:id', rol(...P.verPedidos), PedidoController.obtener);
router.put('/pedidos/:id', rol(...P.editarPedido), PedidoController.actualizar);
router.patch('/pedidos/:id/estado', rol(...P.gestionarEstado), PedidoController.cambiarEstado);
router.post('/pedidos/:id/reprogramar', rol(...P.reprogramar), PedidoController.reprogramar);
router.patch('/pedidos/:id/observaciones', rol(...P.observacionesAlmacen), PedidoController.observacionesAlmacen);

// --- Vehículos ---
router.get('/vehiculos', rol(...P.gestionarRutas, ...P.monitoreo), VehiculoController.listar);
router.post('/vehiculos', rol(...P.gestionarRutas), VehiculoController.crear);
router.put('/vehiculos/:id', rol(...P.gestionarRutas), VehiculoController.actualizar);

// --- Ubicaciones frecuentes (Falabella, almacenes, proveedores…) ---
router.get('/ubicaciones', rol(...P.despacho, 'vendedor'), UbicacionController.listar);
router.post('/ubicaciones', rol(...P.despacho, 'vendedor'), UbicacionController.crear); // cualquiera que registre pedidos
router.put('/ubicaciones/:id', rol(...P.gestionarRutas), UbicacionController.actualizar);

// --- Rutas (planificación) ---
router.get('/rutas', rol(...P.despacho), RutaController.listar);
router.get('/rutas/historial', rol(...P.gestionarRutas, ...P.monitoreo), RutaController.historial);
router.get('/rutas/pedidos-sin-ruta', rol(...P.gestionarRutas), RutaController.pedidosSinRuta);
router.post('/rutas', rol(...P.gestionarRutas), RutaController.crear);
router.post('/rutas/asignar-auto', rol(...P.gestionarRutas), RutaController.asignarAuto);
router.get('/rutas/:id', rol(...P.gestionarRutas, ...P.monitoreo), RutaController.obtener);
router.put('/rutas/:id', rol(...P.gestionarRutas), RutaController.actualizar);
router.delete('/rutas/:id', rol(...P.gestionarRutas), RutaController.eliminar);
router.put('/rutas/:id/paradas', rol(...P.gestionarRutas), RutaController.guardarParadas);
router.post('/rutas/:id/trazar', rol(...P.gestionarRutas), RutaController.trazar);
router.post('/rutas/:id/agregar-pedidos', rol(...P.gestionarRutas), RutaController.agregarPedidos);
router.post('/rutas/:id/finalizar', rol(...P.gestionarRutas), RutaController.finalizar);
router.post('/rutas/:id/reoptimizar', rol(...P.gestionarRutas), RutaController.reoptimizarWeb);
router.post('/rutas/paradas/:id/mover', rol(...P.gestionarRutas), RutaController.moverParada);
router.patch('/rutas/:id/despacho', rol(...P.despacho), RutaController.despachar);
router.get('/rutas/:id/historial', rol(...P.despacho), RutaController.historialCambios);
router.get('/rutas/:id/mensajes', rol(...P.chatRuta), RutaController.mensajes);
router.post('/rutas/:id/mensajes', rol(...P.chatRuta), RutaController.enviarMensaje);
router.get('/rutas/:id/recorrido', rol(...P.monitoreo), RutaController.recorrido);

// --- Monitoreo en vivo ---
router.get('/monitoreo', rol(...P.monitoreo), RutaController.monitoreo);

// --- Reportes (exportables a Excel) ---
router.get('/reportes', rol(...P.estadisticas, 'catalogo', 'rrhh'), ReporteController.listar);
router.get('/reportes/:clave', rol(...P.estadisticas, 'catalogo', 'rrhh'), ReporteController.ejecutar);

// --- Estadísticas ---
router.get('/estadisticas', rol(...P.estadisticas), CatalogoController.estadisticas);

// --- Recursos Humanos ---
const documento = express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], limit: '4mb' });
// Mi espacio: cada colaborador (web y app) ve y registra solo lo suyo
router.get('/rrhh/mi', RH.mi);
router.post('/rrhh/mi/marcar', RH.marcar);
router.get('/rrhh/mi/asistencia', RH.miAsistencia);
router.get('/rrhh/mi/solicitudes', RH.misSolicitudes);
router.post('/rrhh/mi/solicitudes', RH.crearMiSolicitud);
router.post('/rrhh/mi/solicitudes/:id/anular', RH.anularMiSolicitud);
router.post('/rrhh/mi/solicitudes/:id/documento', documento, RH.adjuntarMiSolicitud);
router.get('/rrhh/documentos/:id/archivo', RH.descargarDocumento); // valida dueño, jefe o RRHH

router.get('/rrhh/dashboard', rol(...P.rrhh), RH.dashboard);
router.get('/rrhh/opciones', rol(...P.rrhh), RH.opciones);
router.get('/rrhh/vencimientos', rol(...P.rrhh), RH.vencimientos);
router.get('/rrhh/colaboradores', rol(...P.rrhhEquipo), RH.listar);
router.post('/rrhh/colaboradores', rol(...P.rrhh), RH.crear);
router.get('/rrhh/colaboradores/:id', rol(...P.rrhhEquipo), RH.obtener);
router.put('/rrhh/colaboradores/:id', rol(...P.rrhh), RH.actualizar);
router.post('/rrhh/colaboradores/:id/documentos', rol(...P.rrhh), documento, RH.subirDocumento);
router.delete('/rrhh/documentos/:id', rol(...P.rrhh), RH.eliminarDocumento);
router.post('/rrhh/colaboradores/:id/derechohabientes', rol(...P.rrhh), RH.guardarDerechohabiente);
router.put('/rrhh/derechohabientes/:dhId', rol(...P.rrhh), RH.guardarDerechohabiente);
router.delete('/rrhh/derechohabientes/:dhId', rol(...P.rrhh), RH.eliminarDerechohabiente);

router.get('/rrhh/horarios', rol(...P.rrhhEquipo), RH.horarios);
router.post('/rrhh/horarios', rol(...P.rrhh), RH.guardarHorario);
router.put('/rrhh/horarios/:id', rol(...P.rrhh), RH.guardarHorario);
router.get('/rrhh/feriados', rol(...P.calendarioEquipo), RH.feriados);
router.post('/rrhh/feriados', rol(...P.rrhh), RH.guardarFeriado);
router.delete('/rrhh/feriados/:fecha', rol(...P.rrhh), RH.eliminarFeriado);

router.get('/rrhh/asistencia', rol(...P.rrhhEquipo), RH.asistencia);
router.get('/rrhh/marcaciones', rol(...P.rrhhEquipo), RH.marcaciones);
router.post('/rrhh/marcaciones', rol(...P.rrhh), RH.marcacionManual);
router.post('/rrhh/marcaciones/importar', rol(...P.rrhh), RH.importarMarcaciones);
router.delete('/rrhh/marcaciones/:id', rol(...P.rrhh), RH.eliminarMarcacion);

router.get('/rrhh/solicitudes', rol(...P.rrhhEquipo), RH.solicitudes);
router.post('/rrhh/solicitudes', rol(...P.rrhh), RH.crearSolicitud);
router.post('/rrhh/solicitudes/:id/resolver', rol(...P.rrhhEquipo), RH.resolverSolicitud);
router.get('/rrhh/calendario', rol(...P.calendarioEquipo), RH.calendario);
router.get('/rrhh/ausentes', rol(...P.calendarioEquipo), RH.ausentes);

// --- App del repartidor (Flutter) ---
router.get('/repartidor/rutas', rol(...P.appRepartidor), RutaController.misRutas);
router.post('/repartidor/rutas/:id/iniciar', rol(...P.appRepartidor), RutaController.iniciarRuta);
router.patch('/repartidor/paradas/:id', rol(...P.appRepartidor), RutaController.atenderParada);
router.post('/repartidor/rutas/:id/tramo', rol(...P.appRepartidor), RutaController.tramoActual);
router.post('/repartidor/rutas/:id/reoptimizar', rol(...P.appRepartidor), RutaController.reoptimizarApp);
router.post('/repartidor/rutas/:id/finalizar', rol(...P.appRepartidor), RutaController.finalizarApp);
router.post('/repartidor/paradas/:id/foto', rol(...P.appRepartidor),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }), RutaController.subirFoto);
router.post('/repartidor/ubicacion', rol(...P.appRepartidor), RutaController.registrarPosicion);

export default router;
