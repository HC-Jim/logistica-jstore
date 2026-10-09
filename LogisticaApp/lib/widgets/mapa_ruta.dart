import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../models/modelos.dart';
import '../utils/formato.dart';

/// Mapa de la ruta con OpenStreetMap (no requiere clave de Google).
class MapaRuta extends StatelessWidget {
  const MapaRuta({super.key, required this.ruta, required this.deposito, required this.onTapParada});
  final Ruta ruta;
  final Deposito deposito;
  final void Function(Parada) onTapParada;

  @override
  Widget build(BuildContext context) {
    final conPunto = ruta.paradas.where((p) => p.punto != null).toList();
    final puntos = [deposito.punto, ...conPunto.map((p) => p.punto!)];
    final trazado = ruta.polyline == null ? <LatLng>[] : decodificarPolyline(ruta.polyline!);
    final siguiente = ruta.siguiente;

    return Stack(children: [
      FlutterMap(
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
          if (trazado.isNotEmpty)
            PolylineLayer(polylines: [Polyline(points: trazado, strokeWidth: 5, color: const Color(0xCC2B6CB0))]),
          MarkerLayer(markers: [
            Marker(
              point: deposito.punto,
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
                  onTap: () => onTapParada(p),
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
          ]),
          const SimpleAttributionWidget(source: Text('OpenStreetMap')),
        ],
      ),
      if (ruta.distanciaMetros != null)
        Positioned(
          left: 12,
          top: 12,
          child: Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Text('${km(ruta.distanciaMetros)} · ${duracion(ruta.duracionSegundos)}'),
            ),
          ),
        ),
    ]);
  }
}
