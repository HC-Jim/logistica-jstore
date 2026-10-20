import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../api/api_client.dart';

/// Una entrega o incidencia registrada sin señal, esperando a enviarse.
class Pendiente {
  Pendiente({
    required this.id,
    required this.paradaId,
    required this.titulo,
    required this.estado,
    required this.atendidaEn,
    this.nota,
    this.foto,
    this.fotoEnviada = false,
    this.error,
  });

  factory Pendiente.desdeJson(Map<String, dynamic> j) => Pendiente(
        id: '${j['id']}',
        paradaId: j['parada_id'] as int,
        titulo: '${j['titulo'] ?? ''}',
        estado: '${j['estado']}',
        atendidaEn: DateTime.parse('${j['atendida_en']}'),
        nota: j['nota'] as String?,
        foto: j['foto'] as String?,
        fotoEnviada: j['foto_enviada'] == true,
        error: j['error'] as String?,
      );

  final String id;
  final int paradaId;
  final String titulo;
  final String estado; // completada | incidencia
  final DateTime atendidaEn; // hora real en que se atendió (no la del envío)
  final String? nota;
  final String? foto; // ruta del archivo de la foto guardada en el celular
  bool fotoEnviada;
  String? error; // si el servidor la rechazó (p. ej. logística retiró el pedido)

  Map<String, dynamic> aJson() => {
        'id': id, 'parada_id': paradaId, 'titulo': titulo, 'estado': estado, 'atendida_en': atendidaEn.toUtc().toIso8601String(),
        'nota': nota, 'foto': foto, 'foto_enviada': fotoEnviada, 'error': error,
      };
}

/// Cola de entregas hechas sin señal. Se guarda en el celular (sobrevive a cerrar la app) y se envía
/// sola cuando vuelve el internet: primero la foto y luego la entrega, en el orden en que se hicieron.
class ColaService extends ChangeNotifier {
  ColaService._();
  static final ColaService instancia = ColaService._();

  final List<Pendiente> _items = [];
  bool _cargada = false;
  Future<void>? _actual; // envío en curso
  Timer? _timer;
  DateTime? ultimoIntento;

  /// Pendientes de enviar (sin las rechazadas).
  List<Pendiente> get pendientes => _items.where((p) => p.error == null).toList();
  /// Rechazadas por el servidor: hay que avisar a logística.
  List<Pendiente> get rechazadas => _items.where((p) => p.error != null).toList();
  bool get enviando => _actual != null;

  /// Estado guardado localmente para una parada (para mostrarla como atendida aunque no se haya enviado).
  Pendiente? de(int paradaId) => pendientes.where((p) => p.paradaId == paradaId).lastOrNull;

  Future<Directory> _carpeta() async {
    final d = Directory('${(await getApplicationDocumentsDirectory()).path}/cola_entregas');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  Future<File> _archivo() async => File('${(await _carpeta()).path}/cola.json');

  Future<void> cargar() async {
    if (_cargada) return;
    _cargada = true;
    try {
      final f = await _archivo();
      if (await f.exists()) {
        final lista = jsonDecode(await f.readAsString()) as List;
        _items..clear()..addAll(lista.map((x) => Pendiente.desdeJson(x as Map<String, dynamic>)));
      }
    } catch (_) {
      // archivo dañado: se empieza de cero (no se pierde nada del servidor)
    }
    _timer ??= Timer.periodic(const Duration(seconds: 30), (_) => enviar());
    notifyListeners();
    unawaited(enviar());
  }

  Future<void> _guardar() async {
    final f = await _archivo();
    await f.writeAsString(jsonEncode(_items.map((p) => p.aJson()).toList()));
    notifyListeners();
  }

  /// Guarda una entrega o incidencia hecha sin señal (con su foto si aún no se subió) e intenta enviarla.
  Future<void> agregar({required int paradaId, required String titulo, required String estado, String? nota, Uint8List? foto}) async {
    await cargar();
    final id = '${DateTime.now().microsecondsSinceEpoch}';
    String? rutaFoto;
    if (foto != null) {
      final f = File('${(await _carpeta()).path}/foto-$paradaId-$id.jpg');
      await f.writeAsBytes(foto, flush: true);
      rutaFoto = f.path;
    }
    _items.add(Pendiente(id: id, paradaId: paradaId, titulo: titulo, estado: estado, atendidaEn: DateTime.now(), nota: nota, foto: rutaFoto));
    await _guardar();
    unawaited(enviar());
  }

  /// Envía lo pendiente en orden. Se detiene en el primer problema de conexión y reintenta luego.
  /// Si ya hay un envío en curso, espera a que termine y vuelve a intentar con lo que quede.
  Future<void> enviar() async {
    while (_actual != null) {
      await _actual;
    }
    if (!api.tieneSesion || pendientes.isEmpty) return;
    _actual = _enviarAhora();
    notifyListeners();
    try {
      await _actual;
    } finally {
      _actual = null;
      notifyListeners();
    }
  }

  Future<void> _enviarAhora() async {
    ultimoIntento = DateTime.now();
    {
      for (final p in pendientes) {
        try {
          if (p.foto != null && !p.fotoEnviada) {
            final archivo = File(p.foto!);
            if (await archivo.exists()) {
              await api.subir('/repartidor/paradas/${p.paradaId}/foto', await archivo.readAsBytes(), 'image/jpeg');
            }
            p.fotoEnviada = true;
            await _guardar();
          }
          await api.patch('/repartidor/paradas/${p.paradaId}', {
            'estado': p.estado,
            if (p.nota != null && p.nota!.isNotEmpty) 'nota': p.nota,
            'atendida_en': p.atendidaEn.toUtc().toIso8601String(),
          });
          _items.remove(p);
          if (p.foto != null) {
            final f = File(p.foto!);
            if (await f.exists()) await f.delete();
          }
          await _guardar();
        } on ApiException catch (e) {
          if (e.status == 0 || e.status >= 500 || e.status == 401) return; // sin señal o servidor caído: se reintenta después
          p.error = e.mensaje; // el servidor la rechazó: queda para avisar a logística
          await _guardar();
        }
      }
    }
  }

  /// Quita una rechazada (después de avisar a logística).
  Future<void> descartar(Pendiente p) async {
    _items.remove(p);
    if (p.foto != null) {
      final f = File(p.foto!);
      if (await f.exists()) await f.delete();
    }
    await _guardar();
  }
}

final cola = ColaService.instancia;
