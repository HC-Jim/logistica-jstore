import '../api/api_client.dart';
import '../models/modelos.dart';

class RutasDelDia {
  RutasDelDia(this.deposito, this.rutas);
  final Deposito deposito;
  final List<Ruta> rutas;
}

/// Endpoints de la app del conductor/auxiliar (ver docs/API-app-repartidor.md).
class RutasService {
  static Future<RutasDelDia> misRutas(String fecha) async {
    final r = await api.get('/repartidor/rutas', query: {'fecha': fecha}) as Map<String, dynamic>;
    return RutasDelDia(
      Deposito.desdeJson(r['deposito'] as Map<String, dynamic>),
      (r['rutas'] as List).map((x) => Ruta.desdeJson(x as Map<String, dynamic>)).toList(),
    );
  }

  static Future<void> iniciar(int rutaId) => api.post('/repartidor/rutas/$rutaId/iniciar');

  /// estado: 'completada' | 'incidencia'
  static Future<void> atender(int paradaId, String estado, {String? nota}) =>
      api.patch('/repartidor/paradas/$paradaId', {'estado': estado, if (nota != null && nota.isNotEmpty) 'nota': nota});

  static Future<List<Mensaje>> mensajes(int rutaId, {int despues = 0}) async {
    final r = await api.get('/rutas/$rutaId/mensajes', query: {'despues': '$despues'}) as List;
    return r.map((m) => Mensaje.desdeJson(m as Map<String, dynamic>)).toList();
  }

  static Future<Mensaje> enviarMensaje(int rutaId, String texto) async {
    final r = await api.post('/rutas/$rutaId/mensajes', {'texto': texto});
    return Mensaje.desdeJson(r as Map<String, dynamic>);
  }
}
