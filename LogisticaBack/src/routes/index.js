import { Router } from 'express';
import { PERMISOS as P } from '../config/permisos.js';
import { AuthController } from '../controllers/auth.controller.js';
import { CatalogoController } from '../controllers/catalogo.controller.js';
import { PedidoController } from '../controllers/pedido.controller.js';
import { ProductoController } from '../controllers/producto.controller.js';
import { RutaController } from '../controllers/ruta.controller.js';
import { requireAuth, requireRol as rol } from '../middlewares/auth.js';

const router = Router();

// --- Autenticación (web y app del repartidor) ---
router.post('/auth/login', AuthController.login);

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

// --- Rutas (planificación) ---
router.get('/rutas', rol(...P.gestionarRutas), RutaController.listar);
router.get('/rutas/pedidos-sin-ruta', rol(...P.gestionarRutas), RutaController.pedidosSinRuta);
router.post('/rutas', rol(...P.gestionarRutas), RutaController.crear);
router.get('/rutas/:id', rol(...P.gestionarRutas, ...P.monitoreo), RutaController.obtener);
router.put('/rutas/:id', rol(...P.gestionarRutas), RutaController.actualizar);
router.delete('/rutas/:id', rol(...P.gestionarRutas), RutaController.eliminar);
router.put('/rutas/:id/paradas', rol(...P.gestionarRutas), RutaController.guardarParadas);
router.post('/rutas/:id/trazar', rol(...P.gestionarRutas), RutaController.trazar);
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
