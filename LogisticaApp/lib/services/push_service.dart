import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../api/api_client.dart';

/// Avisos push (Firebase Cloud Messaging). Los avisos en sí viven en la API;
/// Firebase solo los entrega al celular. Si no está configurado, la app funciona igual
/// con la bandeja de notificaciones.
class PushService {
  PushService._();
  static final PushService instancia = PushService._();

  static const _canal = AndroidNotificationChannel(
    'avisos',
    'Avisos de rutas',
    description: 'Rutas asignadas, cambios de pedidos y mensajes de logística',
    importance: Importance.high,
  );

  final _locales = FlutterLocalNotificationsPlugin();
  bool _listo = false;
  String? _token;
  StreamSubscription<String>? _renovacion;

  /// Se llama al tocar un aviso: recibe los datos (tipo, ruta_id, fecha, abrir...).
  void Function(Map<String, dynamic> datos)? onAbrir;

  /// Cambia cada vez que llega un aviso, para refrescar el contador de la campana.
  final llegadas = ValueNotifier<int>(0);

  /// Datos del aviso con el que se abrió la app (cerrada), para atenderlo tras cargar la pantalla.
  Map<String, dynamic>? pendiente;

  Future<void> iniciar() async {
    if (_listo) return;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('Push desactivado (falta google-services.json): $e');
      return;
    }
    _listo = true;

    await _locales.initialize(
      settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
      onDidReceiveNotificationResponse: (r) {
        if (r.payload != null) _abrir(jsonDecode(r.payload!) as Map<String, dynamic>);
      },
    );
    await _locales
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_canal);

    // Con la app abierta Android no muestra el aviso: se muestra a mano
    FirebaseMessaging.onMessage.listen((m) {
      llegadas.value++;
      final n = m.notification;
      if (n == null) return;
      _locales.show(
        id: m.hashCode,
        title: n.title,
        body: n.body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(_canal.id, _canal.name,
              channelDescription: _canal.description, importance: Importance.high, priority: Priority.high),
        ),
        payload: jsonEncode(m.data),
      );
    });
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _abrir(m.data));
    final inicial = await FirebaseMessaging.instance.getInitialMessage();
    if (inicial != null) pendiente = inicial.data;
  }

  void _abrir(Map<String, dynamic> datos) {
    if (onAbrir != null) {
      onAbrir!(datos);
    } else {
      pendiente = datos;
    }
  }

  /// Tras iniciar sesión: pide permiso y registra el celular en la API.
  Future<void> registrar() async {
    if (!_listo || !api.tieneSesion) return;
    try {
      await FirebaseMessaging.instance.requestPermission();
      _token = await FirebaseMessaging.instance.getToken();
      if (_token != null) await api.post('/dispositivos', {'token': _token, 'plataforma': 'android'});
      _renovacion ??= FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        _token = t;
        if (api.tieneSesion) api.post('/dispositivos', {'token': t, 'plataforma': 'android'}).ignore();
      });
    } catch (e) {
      debugPrint('No se pudo registrar el celular para avisos: $e');
    }
  }

  /// Antes de cerrar sesión: este celular deja de recibir avisos del usuario.
  Future<void> quitar() async {
    final t = _token;
    if (!_listo || t == null) return;
    try {
      await api.delete('/dispositivos', {'token': t});
    } catch (_) {
      // si falla, la API lo borra cuando otro usuario registre el mismo celular
    }
  }
}

final push = PushService.instancia;
