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
  obtener: (id) => data(api.get(`/productos/${id}`)),
  dashboard: (dias) => data(api.get('/productos/dashboard', { params: { dias } })),
  proponerSku: (subcategoria_id, tipo) => data(api.get('/productos/proponer-sku', { params: { subcategoria_id, tipo } })),
  guardarComponentes: (id, componentes) => data(api.put(`/productos/${id}/componentes`, { componentes })),
  matriz: () => data(api.get('/productos/matriz')),
  gruposAnteriores: () => data(api.get('/productos/reclasificar')),
  reclasificar: (body) => data(api.post('/productos/reclasificar', body)),
  guardarCategoria: (id, body) => data(id ? api.put(`/productos/categorias/${id}`, body) : api.post('/productos/categorias', body)),
  guardarSubcategoria: (id, body) => data(id ? api.put(`/productos/subcategorias/${id}`, body) : api.post('/productos/subcategorias', body)),
  marcas: () => data(api.get('/productos/marcas')),
  guardarMarca: (id, body) => data(id ? api.put(`/productos/marcas/${id}`, body) : api.post('/productos/marcas', body)),
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
  importar: (filas, confirmar) => data(api.post('/pedidos/importar', { filas, confirmar })),
  plantilla: () => data(api.get('/pedidos/plantilla')),
};

export const preciosApi = {
  plataformas: () => data(api.get('/precios/plataformas')),
  dashboard: (dias) => data(api.get('/precios/dashboard', { params: { dias } })),
  listasBsale: () => data(api.get('/precios/listas-bsale')),
  bsaleDeProducto: (id, actualizar) => data(api.get(`/precios/producto/${id}/bsale`, { params: { actualizar: actualizar ? 1 : undefined } })),
  importar: (filas, confirmar) => data(api.post('/precios/importar', { filas, confirmar })),
  vigentes: (params) => data(api.get('/precios/vigentes', { params })),
  historial: (productoId) => data(api.get(`/precios/producto/${productoId}`)),
  registrar: (body) => data(api.post('/precios', body)),
  descuentos: () => data(api.get('/precios/descuentos')),
  guardarDescuentos: (grupo, tramos) => data(api.put('/precios/descuentos', { grupo, tramos })),
};

export const rrhhApi = {
  dashboard: () => data(api.get('/rrhh/dashboard')),
  opciones: () => data(api.get('/rrhh/opciones')),
  colaboradores: (params) => data(api.get('/rrhh/colaboradores', { params })),
  colaborador: (id) => data(api.get(`/rrhh/colaboradores/${id}`)),
  crear: (body) => data(api.post('/rrhh/colaboradores', body)),
  actualizar: (id, body) => data(api.put(`/rrhh/colaboradores/${id}`, body)),
  subirDocumento: (id, archivo, params) => data(api.post(`/rrhh/colaboradores/${id}/documentos`, archivo, {
    params, headers: { 'Content-Type': archivo.type },
  })),
  eliminarDocumento: (id) => data(api.delete(`/rrhh/documentos/${id}`)),
  guardarDerechohabiente: (colaboradorId, id, body) => data(id
    ? api.put(`/rrhh/derechohabientes/${id}`, body)
    : api.post(`/rrhh/colaboradores/${colaboradorId}/derechohabientes`, body)),
  eliminarDerechohabiente: (id) => data(api.delete(`/rrhh/derechohabientes/${id}`)),
  /** Abre el archivo en otra pestaña (se descarga con la sesión: no hay enlaces públicos). */
  async verDocumento(id) {
    const ventana = window.open('', '_blank'); // se abre antes de la descarga para que el navegador no la bloquee
    try {
      const r = await api.get(`/rrhh/documentos/${id}/archivo`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      if (ventana) ventana.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      ventana?.close();
      throw err;
    }
  },
  vencimientos: (dias) => data(api.get('/rrhh/vencimientos', { params: { dias } })),
  horarios: () => data(api.get('/rrhh/horarios')),
  guardarHorario: (id, body) => data(id ? api.put(`/rrhh/horarios/${id}`, body) : api.post('/rrhh/horarios', body)),
  feriados: (anio) => data(api.get('/rrhh/feriados', { params: { anio } })),
  guardarFeriado: (body) => data(api.post('/rrhh/feriados', body)),
  eliminarFeriado: (fecha) => data(api.delete(`/rrhh/feriados/${fecha}`)),
  asistencia: (params) => data(api.get('/rrhh/asistencia', { params })),
  marcaciones: (colaborador_id, fecha) => data(api.get('/rrhh/marcaciones', { params: { colaborador_id, fecha } })),
  marcacionManual: (body) => data(api.post('/rrhh/marcaciones', body)),
  eliminarMarcacion: (id) => data(api.delete(`/rrhh/marcaciones/${id}`)),
  importarMarcaciones: (filas) => data(api.post('/rrhh/marcaciones/importar', { filas })),
  solicitudes: (params) => data(api.get('/rrhh/solicitudes', { params })),
  crearSolicitud: (body) => data(api.post('/rrhh/solicitudes', body)),
  resolverSolicitud: (id, estado, respuesta) => data(api.post(`/rrhh/solicitudes/${id}/resolver`, { estado, respuesta })),
  calendario: (mes) => data(api.get('/rrhh/calendario', { params: { mes } })),
  ausentes: (fecha) => data(api.get('/rrhh/ausentes', { params: { fecha } })),
  // mi espacio
  mi: () => data(api.get('/rrhh/mi')),
  marcar: (body) => data(api.post('/rrhh/mi/marcar', body)),
  miAsistencia: (mes) => data(api.get('/rrhh/mi/asistencia', { params: { mes } })),
  misSolicitudes: () => data(api.get('/rrhh/mi/solicitudes')),
  solicitar: (body) => data(api.post('/rrhh/mi/solicitudes', body)),
  anularMiSolicitud: (id) => data(api.post(`/rrhh/mi/solicitudes/${id}/anular`)),
  adjuntarMiSolicitud: (id, archivo) => data(api.post(`/rrhh/mi/solicitudes/${id}/documento`, archivo, {
    params: { nombre: archivo.name }, headers: { 'Content-Type': archivo.type },
  })),
};

export const bsaleApi = {
  estado: () => data(api.get('/bsale/estado')),
  guardarListas: (listas) => data(api.put('/bsale/listas', { listas })),
  leer: (paso) => data(api.post(`/bsale/leer/${encodeURIComponent(paso)}`)),
  diferencias: () => data(api.get('/bsale/diferencias')),
  enviarPrecios: (productoIds) => data(api.post('/bsale/precios', productoIds ? { producto_ids: productoIds } : {})),
  crear: (productoIds) => data(api.post('/bsale/productos', { producto_ids: productoIds })),
  nombres: (productoIds) => data(api.post('/bsale/nombres', { producto_ids: productoIds })),
  catalogo: () => data(api.get('/bsale/catalogo')),
  categorias: (categoriaIds) => data(api.post('/bsale/categorias', { categoria_ids: categoriaIds })),
  fichas: (productoIds) => data(api.post('/bsale/fichas', { producto_ids: productoIds })),
  envios: (soloErrores) => data(api.get('/bsale/envios', { params: { errores: soloErrores ? 1 : undefined } })),
};

export const reportesApi = {
  listar: (modulo) => data(api.get('/reportes', { params: { modulo } })),
  ejecutar: (clave, params) => data(api.get(`/reportes/${clave}`, { params })),
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
  moverParada: (paradaId, rutaId) => data(api.post(`/rutas/paradas/${paradaId}/mover`, { ruta_id: rutaId })),
  trazar: (id, optimizar) => data(api.post(`/rutas/${id}/trazar`, { optimizar })),
  agregarPedidos: (id, pedidoIds, optimizar = true) => data(api.post(`/rutas/${id}/agregar-pedidos`, { pedido_ids: pedidoIds, optimizar })),
  asignarAuto: (body) => data(api.post('/rutas/asignar-auto', body)),
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
