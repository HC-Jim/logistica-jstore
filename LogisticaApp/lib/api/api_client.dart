import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

class ApiException implements Exception {
  ApiException(this.status, this.mensaje);
  final int status;
  final String mensaje;

  @override
  String toString() => mensaje;
}

/// Cliente HTTP de la API de Logística JStore. Guarda el token de sesión de forma segura.
class ApiClient {
  ApiClient._();
  static final ApiClient instancia = ApiClient._();

  final _almacen = const FlutterSecureStorage();
  String? _token;
  Map<String, dynamic>? usuario;

  /// Se llama cuando el servidor rechaza el token (sesión vencida).
  void Function()? onSesionExpirada;

  bool get tieneSesion => _token != null;
  int? get usuarioId => usuario?['id'] as int?;

  Future<void> cargarSesion() async {
    _token = await _almacen.read(key: 'token');
    final u = await _almacen.read(key: 'usuario');
    usuario = u == null ? null : jsonDecode(u) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    final r = await post('/auth/login', {'email': email.trim(), 'password': password}) as Map<String, dynamic>;
    final u = r['usuario'] as Map<String, dynamic>;
    if (!['repartidor', 'auxiliar'].contains(u['rol'])) {
      throw ApiException(403, 'Esta app es para conductores y auxiliares. Usa la web de Logística JStore.');
    }
    _token = r['token'] as String;
    usuario = u;
    await _almacen.write(key: 'token', value: _token);
    await _almacen.write(key: 'usuario', value: jsonEncode(u));
    return u;
  }

  Future<void> cerrarSesion() async {
    _token = null;
    usuario = null;
    await _almacen.deleteAll();
  }

  Future<dynamic> get(String ruta, {Map<String, String>? query}) => _enviar('GET', ruta, query: query);
  Future<dynamic> post(String ruta, [Object? cuerpo]) => _enviar('POST', ruta, cuerpo: cuerpo);
  Future<dynamic> patch(String ruta, [Object? cuerpo]) => _enviar('PATCH', ruta, cuerpo: cuerpo);
  /// Envía un archivo (p. ej. la foto de la entrega) como cuerpo de la petición.
  Future<dynamic> subir(String ruta, List<int> bytes, String tipo) => _enviar('POST', ruta, bytes: bytes, tipo: tipo);
  Future<dynamic> delete(String ruta, [Object? cuerpo]) => _enviar('DELETE', ruta, cuerpo: cuerpo);

  Future<dynamic> _enviar(String metodo, String ruta, {Map<String, String>? query, Object? cuerpo, List<int>? bytes, String? tipo}) async {
    final uri = Uri.parse('$apiUrl$ruta').replace(queryParameters: query);
    final headers = {
      'Content-Type': tipo ?? 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
    final Object? body = bytes ?? (cuerpo == null ? null : jsonEncode(cuerpo));

    http.Response res;
    try {
      res = await switch (metodo) {
        'GET' => http.get(uri, headers: headers),
        'POST' => http.post(uri, headers: headers, body: body),
        'PATCH' => http.patch(uri, headers: headers, body: body),
        'DELETE' => http.delete(uri, headers: headers, body: body),
        _ => throw ArgumentError(metodo),
      }.timeout(Duration(seconds: bytes == null ? 30 : 90));
    } on TimeoutException {
      throw ApiException(0, 'El servidor tardó demasiado. Intenta de nuevo.');
    } catch (_) {
      throw ApiException(0, 'Sin conexión. Revisa tus datos móviles o el wifi.');
    }

    if (res.statusCode == 401 && _token != null) {
      await cerrarSesion();
      onSesionExpirada?.call();
    }
    final datos = res.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 400) {
      final mensaje = datos is Map && datos['error'] != null ? datos['error'] as String : 'Error ${res.statusCode}';
      throw ApiException(res.statusCode, mensaje);
    }
    return datos;
  }
}

final api = ApiClient.instancia;
