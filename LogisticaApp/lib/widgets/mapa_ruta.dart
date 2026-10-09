import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../models/modelos.dart';
import '../services/gps_service.dart';
import '../services/rutas_service.dart';
import '../utils/formato.dart';

/// Cada cuánto se pide el camino restante mientras se avanza. El servidor solo consulta a Google
/// si cambió el destino o el conductor se desvió; si no, devuelve el último cálculo.
const _refresco = Duration(seconds: 20);

/// Mapa de la ruta con OpenStreetMap (no requiere clave de Google).
/// Con la ruta en curso y el GPS activo muestra el camino desde el conductor hasta su
/// próxima parada (resaltado), lo que le falta hasta el almacén y, sin pendientes, el regreso.
class MapaRuta extends StatefulWidget {
  const MapaRuta({super.key, required this.ruta, required this.deposito, required this.onTapParada, required this.onRecargar});
  final Ruta ruta;
  final Deposito deposito;
  final void Function(Parada) onTapParada;

  /// Vuelve a cargar la ruta (p. ej. logística canceló un pedido o la ruta terminó).
  final Future<void> Function() onRecargar;

  @override
  State<MapaRuta> createState() => _MapaRutaState();
}

class _MapaRutaState extends State<MapaRuta> {
  final _mapa = MapController();
  Tramo? _tramo;
  String? _claveTramo; // destino para el que se pidió el tramo actual
  DateTime? _pedidoEn;
  bool _pidiendo = false;
  String? _error;

  Ruta get ruta => widget.ruta;

  @override
  void initState() {
    super.initState();
    gps.addListener(_revisar);
    WidgetsBinding.instance.addPostFrameCallback((_) => _revisar());
  }

  @override
  void didUpdateWidget(MapaRuta anterior) {
    super.didUpdateWidget(anterior);
    // p. ej. al marcar una parada como entregada cambia el destino
    WidgetsBinding.instance.addPostFrameCallback((_) => _revisar());
  }

  @override
  void dispose() {
    gps.removeListener(_revisar);
    super.dispose();
  }

  bool get _siguiendo => ruta.estado == 'en_curso' && gps.activo && gps.rutaId == ruta.id && gps.ultima != null;

  /// Destino que corresponde según el estado de las paradas.
  String get _claveDestino {
    final proxima = ruta.paradas.where((p) => p.pendiente && p.punto != null).firstOrNull;
    return proxima == null ? 'almacen' : 'parada-${proxima.id}';
  }

  LatLng? get _yo => gps.ultima == null ? null : LatLng(gps.ultima!.latitude, gps.ultima!.longitude);

  void _revisar() {
    if (!mounted) return;
    if (!_siguiendo) {
      if (_tramo != null) setState(() => _tramo = null);
      return;
    }
    setState(() {}); // mover el marcador del conductor
    if (_pidiendo) return;
    final clave = _claveDestino;
    final toca = _pedidoEn == null || DateTime.now().difference(_pedidoEn!) > _refresco;
    // tras un error se espera el refresco antes de reintentar
    if ((clave != _claveTramo && _error == null) || toca) _pedirTramo(clave);
  }

  Future<void> _pedirTramo(String clave) async {
    final yo = _yo!;
    _pidiendo = true;
    _pedidoEn = DateTime.now();
    try {
      final t = await RutasService.tramo(ruta.id, yo.latitude, yo.longitude);
      if (!mounted) return;
      final nuevoDestino = _tramo == null || t.paradaId != _tramo!.paradaId || t.haciaAlmacen != _tramo!.haciaAlmacen;
      setState(() {
        _tramo = t;
        _claveTramo = clave;
        _error = null;
      });
      if (nuevoDestino) _encuadrar([yo, t.destino, ...t.puntos]);
      // el servidor ya no considera la parada que la app cree siguiente (p. ej. logística la canceló)
      final local = clave == 'almacen' ? null : int.tryParse(clave.substring(7));
      if (t.paradaId != local) widget.onRecargar();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.mensaje);
      if (e.status == 409) widget.onRecargar(); // la ruta terminó
    } finally {
      _pidiendo = false;
    }
  }

  Future<void> _reordenar() async {
    final yo = _yo;
    if (yo == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Reordenar paradas pendientes?'),
        content: const Text('Se ordenan por el camino más corto desde donde estás. Logística verá el nuevo orden.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reordenar')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final t = await RutasService.reoptimizar(ruta.id, yo.latitude, yo.longitude);
      if (!mounted) return;
      setState(() {
        _tramo = t;
        _claveTramo = null; // se actualiza con la ruta recargada
        _pedidoEn = DateTime.now();
      });
      _encuadrar([yo, t.destino, ...t.puntos]);
      await widget.onRecargar();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }

  void _encuadrar(List<LatLng> puntos) {
    if (puntos.length < 2) return;
    _mapa.fitCamera(CameraFit.bounds(bounds: LatLngBounds.fromPoints(puntos), padding: const EdgeInsets.fromLTRB(48, 110, 48, 96)));
  }

  Future<void> _navegar() async {
    final d = _tramo?.destino;
    if (d == null) return;
    final uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${d.latitude},${d.longitude}&travelmode=driving');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudo abrir Google Maps')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final conPunto = ruta.paradas.where((p) => p.punto != null).toList();
    final puntos = [widget.deposito.punto, ...conPunto.map((p) => p.punto!)];
    final trazado = ruta.polyline == null ? <LatLng>[] : decodificarPolyline(ruta.polyline!);
    final siguiente = ruta.siguiente;
    final tramo = _siguiendo ? _tramo : null;
    final yo = _siguiendo ? _yo : null;

    return Stack(children: [
      FlutterMap(
        mapController: _mapa,
        options: MapOptions(
          initialCameraFit: puntos.length > 1
              ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(puntos), padding: const EdgeInsets.all(48))
              : null,
          initialCenter: puntos.first,
          initialZoom: 13,
        ),
        children: [
          TileLayer(
            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            userAgentPackageName: 'pe.jotastore.logistica_app',
          ),
          PolylineLayer(polylines: [
            // recorrido planificado completo: de fondo cuando hay un tramo activo
            if (trazado.isNotEmpty)
              Polyline(
                points: trazado,
                strokeWidth: tramo == null ? 5 : 3,
                color: tramo == null ? const Color(0xCC2B6CB0) : const Color(0x332B6CB0),
              ),
            // lo que falta después del próximo destino
            if (tramo != null && tramo.restantePuntos.isNotEmpty)
              Polyline(points: tramo.restantePuntos, strokeWidth: 4, color: const Color(0x992B6CB0)),
            if (tramo != null && tramo.puntos.isNotEmpty)
              Polyline(points: tramo.puntos, strokeWidth: 7, color: const Color(0xFF2B6CB0), borderStrokeWidth: 2, borderColor: Colors.white),
          ]),
          MarkerLayer(markers: [
            Marker(
              point: widget.deposito.punto,
              width: 40,
              height: 40,
              child: const CircleAvatar(backgroundColor: Color(0xFF1A202C), child: Text('A', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            ),
            for (final p in conPunto)
              Marker(
                point: p.punto!,
                width: 40,
                height: 40,
                child: GestureDetector(
                  onTap: () => widget.onTapParada(p),
                  child: Container(
                    decoration: BoxDecoration(
                      color: coloresEstadoParada[p.estado],
                      shape: BoxShape.circle,
                      border: Border.all(color: p.id == siguiente?.id ? Colors.amber : Colors.white, width: 3),
                      boxShadow: const [BoxShadow(blurRadius: 4, color: Colors.black38)],
                    ),
                    alignment: Alignment.center,
                    child: Text('${ruta.paradas.indexOf(p) + 1}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ),
                ),
              ),
            if (yo != null)
              Marker(
                point: yo,
                width: 44,
                height: 44,
                child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFF3182CE),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                    boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black45)],
                  ),
                  child: Icon(iconosVehiculo[ruta.vehiculoTipo] ?? Icons.local_shipping, color: Colors.white, size: 22),
                ),
              ),
          ]),
          const SimpleAttributionWidget(source: Text('OpenStreetMap')),
        ],
      ),
      Positioned(left: 12, right: 12, top: 12, child: _resumen(tramo)),
      if (tramo != null)
        Positioned(
          right: 12,
          bottom: 36,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (ruta.paradas.where((p) => p.pendiente && p.punto != null).length > 1) ...[
              FloatingActionButton.small(
                heroTag: 'reordenar',
                tooltip: 'Reordenar paradas pendientes',
                onPressed: _reordenar,
                child: const Icon(Icons.alt_route),
              ),
              const SizedBox(height: 8),
            ],
            FloatingActionButton.small(
              heroTag: 'centrar',
              tooltip: 'Ver mi tramo',
              onPressed: () => _encuadrar([?yo, tramo.destino, ...tramo.puntos]),
              child: const Icon(Icons.my_location),
            ),
            const SizedBox(height: 8),
            FloatingActionButton.extended(
              heroTag: 'navegar',
              onPressed: _navegar,
              icon: const Icon(Icons.navigation),
              label: const Text('Navegar'),
            ),
          ]),
        ),
    ]);
  }

  Widget _resumen(Tramo? tramo) {
    if (tramo != null) {
      final n = tramo.paradaId == null ? null : ruta.paradas.indexWhere((p) => p.id == tramo.paradaId) + 1;
      return Card(
        child: ListTile(
          dense: true,
          leading: Icon(tramo.haciaAlmacen ? Icons.warehouse : Icons.flag, color: const Color(0xFF2B6CB0)),
          title: Text(
            tramo.haciaAlmacen ? 'Regreso al almacén' : 'Próxima: ${n != null && n > 0 ? '#$n · ' : ''}${tramo.titulo}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          subtitle: Text('${km(tramo.distanciaMetros)} · ${duracion(tramo.duracionSegundos)} aprox.'
              '${tramo.haciaAlmacen ? '' : '\nTe falta: ${km(tramo.restanteMetros)} · ${duracion(tramo.restanteSegundos)} hasta volver al almacén'}'),
          isThreeLine: !tramo.haciaAlmacen,
        ),
      );
    }
    final texto = [
      if (ruta.distanciaMetros != null) 'Recorrido total: ${km(ruta.distanciaMetros)} · ${duracion(ruta.duracionSegundos)}',
      if (_siguiendo && _error != null) _error!,
      if (!_siguiendo && ruta.estado != 'finalizada') 'Inicia la ruta con el GPS activo para ver el camino a tu próxima parada.',
    ];
    if (texto.isEmpty) return const SizedBox.shrink();
    return Align(
      alignment: Alignment.topLeft,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Text(texto.join('\n')),
        ),
      ),
    );
  }
}
