import { Router } from 'express';
import { PERMISOS as P } from '../config/permisos.js';
import { AuthController } from '../controllers/auth.controller.js';
import { CatalogoController } from '../controllers/catalogo.controller.js';
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

// --- Catálogos ---
router.get('/catalogos', CatalogoController.catalogos);
router.get('/ubigeos', CatalogoController.ubigeos);
router.post('/ubicacion/resolver', CatalogoController.resolverUbicacion);

// --- Usuarios ---
// la lista (p. ej. ?rol=repartidor) la usa logística para asignar rutas
router.get('/usuarios', rol('admin', 'planificador'), AuthController.listarUsuarios);
router.post('/usuarios', rol(...P.usuarios), AuthController.crearUsuario);
router.put('/usuarios/:id', rol(...P.usuarios), AuthController.actualizarUsuario);
router.post('/usuarios/:id/aprobar', rol(...P.usuarios), AuthController.aprobarUsuario);
router.delete('/usuarios/:id', rol(...P.usuarios), AuthController.rechazarUsuario);

// --- Productos ---
router.get('/productos', rol(...P.verProductos), ProductoController.listar);
router.post('/productos/importar', rol(...P.gestionarProductos), ProductoController.importar);
router.post('/productos', rol(...P.gestionarProductos), ProductoController.crear);
router.put('/productos/:id', rol(...P.gestionarProductos), ProductoController.actualizar);
router.delete('/productos/:id', rol(...P.gestionarProductos), ProductoController.eliminar);

// --- Pedidos ---
router.get('/pedidos', rol(...P.verPedidos), PedidoController.listar);
router.post('/pedidos', rol(...P.crearPedido), PedidoController.crear);
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
router.post('/ubicaciones', rol(...P.gestionarRutas), UbicacionController.crear);
router.put('/ubicaciones/:id', rol(...P.gestionarRutas), UbicacionController.actualizar);

// --- Rutas (planificación) ---
router.get('/rutas', rol(...P.despacho), RutaController.listar);
router.get('/rutas/historial', rol(...P.gestionarRutas, ...P.monitoreo), RutaController.historial);
router.get('/rutas/pedidos-sin-ruta', rol(...P.gestionarRutas), RutaController.pedidosSinRuta);
router.post('/rutas', rol(...P.gestionarRutas), RutaController.crear);
router.get('/rutas/:id', rol(...P.gestionarRutas, ...P.monitoreo), RutaController.obtener);
router.put('/rutas/:id', rol(...P.gestionarRutas), RutaController.actualizar);
router.delete('/rutas/:id', rol(...P.gestionarRutas), RutaController.eliminar);
router.put('/rutas/:id/paradas', rol(...P.gestionarRutas), RutaController.guardarParadas);
router.post('/rutas/:id/trazar', rol(...P.gestionarRutas), RutaController.trazar);
router.post('/rutas/:id/finalizar', rol(...P.gestionarRutas), RutaController.finalizar);
router.patch('/rutas/:id/despacho', rol(...P.despacho), RutaController.despachar);
router.get('/rutas/:id/historial', rol(...P.despacho), RutaController.historialCambios);
router.get('/rutas/:id/mensajes', rol(...P.chatRuta), RutaController.mensajes);
router.post('/rutas/:id/mensajes', rol(...P.chatRuta), RutaController.enviarMensaje);
router.get('/rutas/:id/recorrido', rol(...P.monitoreo), RutaController.recorrido);

// --- Monitoreo en vivo ---
router.get('/monitoreo', rol(...P.monitoreo), RutaController.monitoreo);

// --- Estadísticas ---
router.get('/estadisticas', rol(...P.estadisticas), CatalogoController.estadisticas);

// --- App del repartidor (Flutter) ---
router.get('/repartidor/rutas', rol(...P.appRepartidor), RutaController.misRutas);
router.post('/repartidor/rutas/:id/iniciar', rol(...P.appRepartidor), RutaController.iniciarRuta);
router.patch('/repartidor/paradas/:id', rol(...P.appRepartidor), RutaController.atenderParada);
router.post('/repartidor/ubicacion', rol(...P.appRepartidor), RutaController.registrarPosicion);

export default router;
