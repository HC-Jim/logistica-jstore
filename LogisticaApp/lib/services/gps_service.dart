import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../api/api_client.dart';
import '../config.dart';

/// Comparte la ubicación del conductor con logística mientras la ruta está en curso.
/// En Android usa un servicio en primer plano (notificación fija) para seguir enviando
/// la posición aunque la pantalla esté apagada o la app en segundo plano.
class GpsService extends ChangeNotifier {
  GpsService._();
  static final GpsService instancia = GpsService._();

  StreamSubscription<Position>? _suscripcion;
  Timer? _latido;
  Position? _ultima;
  DateTime? _ultimoEnvio;
  int? rutaId;
  String? error;

  bool get activo => _suscripcion != null;
  DateTime? get ultimoEnvio => _ultimoEnvio;

  Future<String?>? _arrancando;

  /// Devuelve null si arrancó bien, o el motivo por el que no se pudo.
  /// Si se llama varias veces seguidas, todas esperan la misma solicitud de permiso
  /// (Android solo permite una a la vez).
  Future<String?> iniciar(int rutaId) {
    if (activo && this.rutaId == rutaId) return Future.value(null);
    return _arrancando ??= _arrancar(rutaId).whenComplete(() => _arrancando = null);
  }

  Future<String?> _arrancar(int rutaId) async {
    try {
      return await _arrancarSinControl(rutaId);
    } catch (_) {
      return 'No se pudo activar la ubicación. Revisa los permisos de la app.';
    }
  }

  Future<String?> _arrancarSinControl(int rutaId) async {
    detener();

    if (!await Geolocator.isLocationServiceEnabled()) {
      return 'Activa la ubicación (GPS) del celular para compartir tu posición.';
    }
    var permiso = await Geolocator.checkPermission();
    if (permiso == LocationPermission.denied) permiso = await Geolocator.requestPermission();
    if (permiso == LocationPermission.denied || permiso == LocationPermission.deniedForever) {
      return 'La app necesita permiso de ubicación para que logística vea tu avance.';
    }

    this.rutaId = rutaId;
    _suscripcion = Geolocator.getPositionStream(locationSettings: _configuracion()).listen(
      (p) {
        _ultima = p;
        _enviar();
      },
      onError: (Object e) {
        error = 'No se pudo leer el GPS';
        notifyListeners();
      },
    );
    // Si el conductor está detenido (entregando) igual se reporta cada cierto tiempo
    _latido = Timer.periodic(intervaloGps, (_) => _enviar());
    error = null;
    notifyListeners();
    return null;
  }

  void detener() {
    _suscripcion?.cancel();
    _latido?.cancel();
    _suscripcion = null;
    _latido = null;
    rutaId = null;
    notifyListeners();
  }

  LocationSettings _configuracion() {
    if (kIsWeb) return const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 20);
    if (defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 20,
        intervalDuration: intervaloGps,
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Ruta en curso',
          notificationText: 'Compartiendo tu ubicación con logística',
          enableWakeLock: true,
        ),
      );
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 20,
        activityType: ActivityType.automotiveNavigation,
        pauseLocationUpdatesAutomatically: false,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
      );
    }
    return const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 20);
  }

  Future<void> _enviar() async {
    final p = _ultima;
    if (p == null || rutaId == null) return;
    // no más de un envío cada ~25 s
    if (_ultimoEnvio != null && DateTime.now().difference(_ultimoEnvio!) < intervaloGps - const Duration(seconds: 5)) return;
    try {
      await api.post('/repartidor/ubicacion', {
        'lat': p.latitude,
        'lng': p.longitude,
        'ruta_id': rutaId,
        if (p.accuracy >= 0) 'precision': p.accuracy,
        if (p.speed >= 0) 'velocidad': p.speed,
        if (p.heading >= 0) 'rumbo': p.heading,
      });
      _ultimoEnvio = DateTime.now();
      error = null;
    } catch (_) {
      error = 'Sin conexión: se reintentará';
    }
    notifyListeners();
  }
}

final gps = GpsService.instancia;
