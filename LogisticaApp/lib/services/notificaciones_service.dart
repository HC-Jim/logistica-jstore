import '../api/api_client.dart';

class Aviso {
  Aviso.desdeJson(Map<String, dynamic> j)
      : id = (j['id'] as num).toInt(),
        tipo = '${j['tipo']}',
        titulo = '${j['titulo']}',
        cuerpo = j['cuerpo'] as String?,
        datos = (j['datos'] as Map?)?.cast<String, dynamic>() ?? const {},
        leida = j['leida'] == true,
        creadoEn = DateTime.parse('${j['creado_en']}').toLocal();

  final int id;
  final String tipo;
  final String titulo;
  final String? cuerpo;
  final Map<String, dynamic> datos;
  bool leida;
  final DateTime creadoEn;
}

/// Bandeja de avisos del usuario (los mismos que llegan como push).
class NotificacionesService {
  static Future<(int, List<Aviso>)> listar() async {
    final r = await api.get('/notificaciones') as Map<String, dynamic>;
    return (
      (r['no_leidas'] as num).toInt(),
      (r['notificaciones'] as List).map((x) => Aviso.desdeJson(x as Map<String, dynamic>)).toList(),
    );
  }

  static Future<int> contador() async =>
      ((await api.get('/notificaciones/contador') as Map<String, dynamic>)['no_leidas'] as num).toInt();

  static Future<void> leer(List<int> ids) => api.post('/notificaciones/leer', {'ids': ids});
  static Future<void> leerTodas() => api.post('/notificaciones/leer', {'todas': true});
}
