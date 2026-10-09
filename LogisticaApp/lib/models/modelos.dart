import 'package:latlong2/latlong.dart';

import '../utils/formato.dart';

double? _decimal(Object? v) => v == null ? null : double.tryParse('$v');
int _entero(Object? v) => v == null ? 0 : int.tryParse('$v') ?? 0;
String? _texto(Object? v) => v == null || '$v'.isEmpty ? null : '$v';

/// Tipos en los que el conductor RECOGE en lugar de entregar.
const tiposRecojo = ['Recojo S.T', 'Recojo de suministros'];

class Item {
  Item.desdeJson(Map<String, dynamic> j)
      : sku = '${j['sku'] ?? ''}',
        descripcion = '${j['descripcion'] ?? ''}',
        cantidad = _entero(j['cantidad']),
        subtotal = _decimal(j['subtotal']) ?? 0;

  final String sku;
  final String descripcion;
  final int cantidad;
  final double subtotal;
}

class Parada {
  Parada.desdeJson(Map<String, dynamic> j)
      : id = _entero(j['id']),
        orden = _entero(j['orden']),
        pedidoId = j['pedido_id'] == null ? null : _entero(j['pedido_id']),
        estado = '${j['estado']}',
        nota = _texto(j['nota']),
        titulo = '${j['titulo'] ?? ''}',
        descripcion = _texto(j['descripcion']),
        direccion = _texto(j['direccion']),
        detalleDomicilio = _texto(j['detalle_domicilio']),
        referencia = _texto(j['referencia']),
        distrito = _texto(j['distrito']),
        clienteNombre = _texto(j['cliente_nombre']),
        clienteTelefono = _texto(j['cliente_telefono']),
        tipoPedido = _texto(j['tipo_pedido']),
        categoria = _texto(j['categoria']) ?? 'venta',
        motivo = _texto(j['motivo']),
        agencia = _texto(j['agencia']),
        cobrar = _texto(j['cobrar']),
        medioPago = _texto(j['medio_pago']),
        notaPedido = _texto(j['nota_pedido']),
        documentoBsale = _texto(j['documento_bsale']),
        linkUbicacion = _texto(j['link_ubicacion']),
        totalPedido = _decimal(j['total_pedido']) ?? 0,
        lat = _decimal(j['lat']),
        lng = _decimal(j['lng']),
        despachado = j['despachado_en'] != null,
        items = ((j['items'] as List?) ?? []).map((i) => Item.desdeJson(i as Map<String, dynamic>)).toList();

  final int id;
  final int orden;
  final int? pedidoId;
  final String estado; // pendiente | completada | incidencia
  final String? nota;
  final String titulo;
  final String? descripcion;
  final String? direccion;
  final String? detalleDomicilio;
  final String? referencia;
  final String? distrito;
  final String? clienteNombre;
  final String? clienteTelefono;
  final String? tipoPedido;
  final String categoria; // venta | inversa | encargo
  final String? motivo;
  final String? agencia;
  final String? cobrar;
  final String? medioPago;
  final String? notaPedido;
  final String? documentoBsale;
  final String? linkUbicacion;
  final double totalPedido;
  final double? lat;
  final double? lng;
  final bool despachado;
  final List<Item> items;

  bool get esAccion => pedidoId == null;
  bool get esRecojo => tiposRecojo.contains(tipoPedido);
  bool get cobra => cobrar != null && cobrar != 'No Cobrar';
  bool get pendiente => estado == 'pendiente';
  LatLng? get punto => lat == null || lng == null ? null : LatLng(lat!, lng!);

  /// "Entregado" o "Recogido" según el tipo.
  String get verboCompletar => esRecojo ? 'Recogido' : 'Entregado';
}

class Ruta {
  Ruta.desdeJson(Map<String, dynamic> j)
      : id = _entero(j['id']),
        numero = _entero(j['numero']),
        fecha = '${j['fecha']}',
        estado = '${j['estado']}',
        vehiculoNombre = _texto(j['vehiculo_nombre']),
        vehiculoTipo = _texto(j['vehiculo_tipo']),
        vehiculoPlaca = _texto(j['vehiculo_placa']),
        conductorId = j['repartidor_id'] == null ? null : _entero(j['repartidor_id']),
        conductorNombre = _texto(j['repartidor_nombre']),
        auxiliarNombre = _texto(j['asistente_nombre']),
        polyline = _texto(j['polyline']),
        distanciaMetros = j['distancia_metros'] == null ? null : _entero(j['distancia_metros']),
        duracionSegundos = j['duracion_segundos'] == null ? null : _entero(j['duracion_segundos']),
        paradas = ((j['paradas'] as List?) ?? []).map((p) => Parada.desdeJson(p as Map<String, dynamic>)).toList()
          ..sort((a, b) => a.orden.compareTo(b.orden));

  final int id;
  final int numero;
  final String fecha;
  final String estado; // planificada | en_curso | finalizada
  final String? vehiculoNombre;
  final String? vehiculoTipo;
  final String? vehiculoPlaca;
  final int? conductorId;
  final String? conductorNombre;
  final String? auxiliarNombre;
  final String? polyline;
  final int? distanciaMetros;
  final int? duracionSegundos;
  final List<Parada> paradas;

  int get atendidas => paradas.where((p) => !p.pendiente).length;
  bool get finalizada => estado == 'finalizada';
  Parada? get siguiente => paradas.where((p) => p.pendiente).firstOrNull;
  double get aCobrar => paradas.where((p) => p.cobra && p.pendiente).fold(0, (s, p) => s + p.totalPedido);
}

class Deposito {
  Deposito.desdeJson(Map<String, dynamic> j)
      : nombre = '${j['nombre'] ?? 'Almacén'}',
        lat = _decimal(j['lat']) ?? 0,
        lng = _decimal(j['lng']) ?? 0;

  final String nombre;
  final double lat;
  final double lng;
  LatLng get punto => LatLng(lat, lng);
}

class Mensaje {
  Mensaje.desdeJson(Map<String, dynamic> j)
      : id = _entero(j['id']),
        texto = '${j['texto']}',
        usuarioId = j['usuario_id'] == null ? null : _entero(j['usuario_id']),
        usuarioNombre = _texto(j['usuario_nombre']) ?? 'Usuario',
        usuarioRol = _texto(j['usuario_rol']),
        creadoEn = DateTime.parse('${j['creado_en']}').toLocal();

  final int id;
  final String texto;
  final int? usuarioId;
  final String usuarioNombre;
  final String? usuarioRol;
  final DateTime creadoEn;
}

/// Tramo actual: de la posición del conductor a su próximo destino.
class Tramo {
  Tramo.desdeJson(Map<String, dynamic> j)
      : haciaAlmacen = (j['destino'] as Map)['tipo'] == 'almacen',
        paradaId = (j['destino'] as Map)['parada_id'] as int?,
        titulo = '${(j['destino'] as Map)['titulo'] ?? ''}',
        destino = LatLng(_decimal((j['destino'] as Map)['lat']) ?? 0, _decimal((j['destino'] as Map)['lng']) ?? 0),
        distanciaMetros = _entero(j['distancia_metros']),
        duracionSegundos = _entero(j['duracion_segundos']),
        puntos = j['polyline'] == null ? const [] : decodificarPolyline('${j['polyline']}');

  final bool haciaAlmacen;
  final int? paradaId;
  final String titulo;
  final LatLng destino;
  final int distanciaMetros;
  final int duracionSegundos;
  final List<LatLng> puntos;
}
