import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:logistica_app/api/api_client.dart';
import 'package:logistica_app/services/cola_service.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

/// Carpeta temporal en lugar de la del celular.
class _RutasFalsas extends PathProviderPlatform with MockPlatformInterfaceMixin {
  _RutasFalsas(this.dir);
  final String dir;
  @override
  Future<String?> getApplicationDocumentsPath() async => dir;
}

void main() {
  late Directory tmp;
  final pedidos = <String>[]; // lo que llegó al "servidor"
  var hayRed = false;
  var rechazar = false;

  /// Servidor simulado: sin red lanza una excepción como cuando no hay señal.
  http.Client cliente() => MockClient((req) async {
        if (!hayRed) throw const SocketException('sin señal');
        final ruta = req.url.path.replaceFirst(RegExp(r'^.*/api'), '');
        if (ruta == '/auth/login') {
          return http.Response(jsonEncode({'token': 't', 'usuario': {'id': 7, 'nombre': 'Conductor', 'roles': ['repartidor']}}), 200);
        }
        if (rechazar && req.method == 'PATCH') {
          return http.Response.bytes(utf8.encode(jsonEncode({'error': 'Logística retiró este pedido de la ruta'})), 409, headers: {'content-type': 'application/json; charset=utf-8'});
        }
        pedidos.add('${req.method} $ruta ${req.method == 'PATCH' ? req.body : '(${req.bodyBytes.length} bytes)'}');
        return http.Response(jsonEncode({'ok': true, 'foto_url': 'x'}), 200);
      });

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    FlutterSecureStorage.setMockInitialValues({});
    tmp = await Directory.systemTemp.createTemp('cola_test');
    PathProviderPlatform.instance = _RutasFalsas(tmp.path);
    hayRed = true;
    await http.runWithClient(() => api.login('c@x.pe', 'x'), cliente);
    hayRed = false;
  });

  tearDownAll(() => tmp.delete(recursive: true));

  test('sin señal la entrega y la foto se guardan; al volver la señal se envían en orden', () async {
    await http.runWithClient(() async {
      await cola.cargar();
      await cola.agregar(paradaId: 11, titulo: 'Cliente Uno', estado: 'completada', foto: Uint8List.fromList(List.filled(2000, 7)));
      await cola.agregar(paradaId: 12, titulo: 'Cliente Dos', estado: 'incidencia', nota: 'Cliente ausente');
      await cola.enviar();
    }, cliente);

    expect(cola.pendientes.length, 2, reason: 'sin señal quedan las dos por enviar');
    expect(pedidos, isEmpty);
    final guardado = jsonDecode(await File('${tmp.path}/cola_entregas/cola.json').readAsString()) as List;
    expect(guardado.length, 2, reason: 'la cola se guarda en el celular (sobrevive a cerrar la app)');
    final foto = guardado.first['foto'] as String;
    expect(await File(foto).length(), 2000, reason: 'la foto queda guardada en un archivo');
    expect(cola.de(11)?.estado, 'completada', reason: 'la parada se ve como atendida');

    hayRed = true;
    await http.runWithClient(() => cola.enviar(), cliente);

    expect(pedidos.length, 3);
    expect(pedidos[0], startsWith('POST /repartidor/paradas/11/foto (2000 bytes)'), reason: 'primero la foto');
    expect(pedidos[1], startsWith('PATCH /repartidor/paradas/11 '));
    expect(pedidos[1], contains('"atendida_en"'), reason: 'se envía la hora real de la entrega');
    expect(pedidos[2], contains('Cliente ausente'));
    expect(cola.pendientes, isEmpty);
    expect(await File(foto).exists(), isFalse, reason: 'la foto se borra del celular una vez enviada');
  });

  test('si el servidor la rechaza, queda para avisar al conductor y no bloquea las demás', () async {
    pedidos.clear();
    hayRed = false;
    await http.runWithClient(() async {
      await cola.agregar(paradaId: 21, titulo: 'Cliente Retirado', estado: 'completada');
    }, cliente);
    hayRed = true;
    rechazar = true;
    await http.runWithClient(() => cola.enviar(), cliente);
    rechazar = false;

    expect(cola.pendientes, isEmpty);
    expect(cola.rechazadas.single.error, contains('Logística retiró'));
    await cola.descartar(cola.rechazadas.single);
    expect(cola.rechazadas, isEmpty);
  });
}
