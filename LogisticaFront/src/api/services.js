import { api } from './client';

const data = (p) => p.then((r) => r.data);

export const authApi = {
  login: (email, password) => data(api.post('/auth/login', { email, password })),
  perfil: () => data(api.get('/auth/perfil')),
  registro: (body) => data(api.post('/auth/registro', body)),
};

export const catalogosApi = {
  catalogos: () => data(api.get('/catalogos')),
  ubigeos: () => data(api.get('/ubigeos')),
  resolverUbicacion: (url) => data(api.post('/ubicacion/resolver', { url })),
};

export const usuariosApi = {
  listar: (params) => data(api.get('/usuarios', { params })),
  crear: (body) => data(api.post('/usuarios', body)),
  actualizar: (id, body) => data(api.put(`/usuarios/${id}`, body)),
  aprobar: (id) => data(api.post(`/usuarios/${id}/aprobar`)),
  rechazar: (id) => data(api.delete(`/usuarios/${id}`)),
};

export const productosApi = {
  listar: (params) => data(api.get('/productos', { params })),
  crear: (body) => data(api.post('/productos', body)),
  actualizar: (id, body) => data(api.put(`/productos/${id}`, body)),
  eliminar: (id) => data(api.delete(`/productos/${id}`)),
  importar: (filas) => data(api.post('/productos/importar', { filas })),
};

export const pedidosApi = {
  listar: (params) => data(api.get('/pedidos', { params })),
  obtener: (id) => data(api.get(`/pedidos/${id}`)),
  crear: (body) => data(api.post('/pedidos', body)),
  actualizar: (id, body) => data(api.put(`/pedidos/${id}`, body)),
  cambiarEstado: (id, estado, motivo) => data(api.patch(`/pedidos/${id}/estado`, { estado, motivo })),
  reprogramar: (id, fecha_entrega, motivo) => data(api.post(`/pedidos/${id}/reprogramar`, { fecha_entrega, motivo })),
  observaciones: (id, observaciones_almacen) => data(api.patch(`/pedidos/${id}/observaciones`, { observaciones_almacen })),
};

export const rutasApi = {
  listar: (fecha) => data(api.get('/rutas', { params: { fecha } })),
  historial: (params) => data(api.get('/rutas/historial', { params })),
  finalizar: (id) => data(api.post(`/rutas/${id}/finalizar`)),
  reoptimizar: (id) => data(api.post(`/rutas/${id}/reoptimizar`)),
  historialCambios: (id) => data(api.get(`/rutas/${id}/historial`)),
  despachar: (id, paradaIds, despachado) => data(api.patch(`/rutas/${id}/despacho`, { parada_ids: paradaIds, despachado })),
  mensajes: (id, despues = 0) => data(api.get(`/rutas/${id}/mensajes`, { params: { despues } })),
  enviarMensaje: (id, texto) => data(api.post(`/rutas/${id}/mensajes`, { texto })),
  obtener: (id) => data(api.get(`/rutas/${id}`)),
  crear: (body) => data(api.post('/rutas', body)),
  actualizar: (id, body) => data(api.put(`/rutas/${id}`, body)),
  eliminar: (id) => data(api.delete(`/rutas/${id}`)),
  guardarParadas: (id, paradas) => data(api.put(`/rutas/${id}/paradas`, { paradas })),
  trazar: (id, optimizar) => data(api.post(`/rutas/${id}/trazar`, { optimizar })),
  pedidosSinRuta: (fecha) => data(api.get('/rutas/pedidos-sin-ruta', { params: { fecha } })),
  recorrido: (id) => data(api.get(`/rutas/${id}/recorrido`)),
  monitoreo: (fecha) => data(api.get('/monitoreo', { params: { fecha } })),
};

export const notificacionesApi = {
  listar: () => data(api.get('/notificaciones')),
  contador: () => data(api.get('/notificaciones/contador')),
  leer: (ids) => data(api.post('/notificaciones/leer', { ids })),
  leerTodas: () => data(api.post('/notificaciones/leer', { todas: true })),
};

export const ubicacionesApi = {
  listar: (params) => data(api.get('/ubicaciones', { params })),
  crear: (body) => data(api.post('/ubicaciones', body)),
  actualizar: (id, body) => data(api.put(`/ubicaciones/${id}`, body)),
};

export const vehiculosApi = {
  listar: (params) => data(api.get('/vehiculos', { params })),
  crear: (body) => data(api.post('/vehiculos', body)),
  actualizar: (id, body) => data(api.put(`/vehiculos/${id}`, body)),
};

export const estadisticasApi = {
  dashboard: (dias = 30) => data(api.get('/estadisticas', { params: { dias } })),
};
