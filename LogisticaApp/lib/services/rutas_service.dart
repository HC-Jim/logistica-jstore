import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../api/api_client.dart';
import '../models/modelos.dart';
import 'cola_service.dart';

class RutasDelDia {
  RutasDelDia(this.deposito, this.rutas, {this.guardadoEn});
  final Deposito deposito;
  final List<Ruta> rutas;
  /// Si no hubo señal: hora en que se guardó la copia que se está mostrando.
  final DateTime? guardadoEn;
  bool get sinConexion => guardadoEn != null;
}

/// Endpoints de la app del conductor/auxiliar (ver docs/API-app-repartidor.md).
class RutasService {
  /// Rutas del día. Se guarda una copia en el celular: sin señal se muestra la última copia
  /// (con las entregas hechas sin señal marcadas como atendidas).
  static Future<RutasDelDia> misRutas(String fecha) async {
    await cola.cargar();
    final archivo = File('${(await getApplicationDocumentsDirectory()).path}/rutas-$fecha.json');
    Map<String, dynamic> r;
    DateTime? guardadoEn;
    try {
      r = await api.get('/repartidor/rutas', query: {'fecha': fecha}) as Map<String, dynamic>;
      await archivo.writeAsString(jsonEncode({'guardado_en': DateTime.now().toIso8601String(), 'datos': r}));
    } on ApiException catch (e) {
      if (e.status != 0 || !await archivo.exists()) rethrow;
      final copia = jsonDecode(await archivo.readAsString()) as Map<String, dynamic>;
      r = copia['datos'] as Map<String, dynamic>;
      guardadoEn = DateTime.tryParse('${copia['guardado_en']}');
    }
    // lo atendido sin señal se ve como atendido (por enviar)
    for (final ruta in (r['rutas'] as List).cast<Map<String, dynamic>>()) {
      for (final parada in ((ruta['paradas'] as List?) ?? []).cast<Map<String, dynamic>>()) {
        final pendiente = cola.de(parada['id'] as int);
        if (pendiente != null && parada['estado'] == 'pendiente') {
          parada['estado'] = pendiente.estado;
          parada['nota'] = pendiente.nota;
          parada['completada_en'] = pendiente.atendidaEn.toIso8601String();
          parada['por_enviar'] = true;
        }
      }
    }
    return RutasDelDia(
      Deposito.desdeJson(r['deposito'] as Map<String, dynamic>),
      (r['rutas'] as List).map((x) => Ruta.desdeJson(x as Map<String, dynamic>)).toList(),
      guardadoEn: guardadoEn,
    );
  }

  /// Camino desde donde está el conductor hasta su próxima parada (o el almacén).
  static Future<Tramo> tramo(int rutaId, double lat, double lng) async =>
      Tramo.desdeJson(await api.post('/repartidor/rutas/$rutaId/tramo', {'lat': lat, 'lng': lng}) as Map<String, dynamic>);

  /// Reordena las paradas pendientes por el camino más corto desde donde está el conductor.
  static Future<Tramo> reoptimizar(int rutaId, double lat, double lng) async =>
      Tramo.desdeJson(await api.post('/repartidor/rutas/$rutaId/reoptimizar', {'lat': lat, 'lng': lng}) as Map<String, dynamic>);

  /// Termina la ruta (el conductor volvió al almacén).
  static Future<void> finalizar(int rutaId) => api.post('/repartidor/rutas/$rutaId/finalizar');

  /// Sube la foto de la entrega (JPG). Devuelve su URL.
  static Future<String> subirFoto(int paradaId, List<int> jpg) async =>
      '${((await api.subir('/repartidor/paradas/$paradaId/foto', jpg, 'image/jpeg')) as Map)['foto_url']}';

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
