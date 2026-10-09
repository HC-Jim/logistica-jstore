import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

final _soles = NumberFormat.currency(locale: 'es_PE', symbol: 'S/ ', decimalDigits: 2);
String soles(num v) => _soles.format(v);

/// 'YYYY-MM-DD' de hoy en hora de Lima (UTC-5, sin horario de verano).
String hoyLima() => DateFormat('yyyy-MM-dd').format(DateTime.now().toUtc().subtract(const Duration(hours: 5)));

String fechaLegible(String iso) {
  final d = DateTime.parse(iso);
  return DateFormat("EEEE d 'de' MMMM", 'es').format(d);
}

String hora(DateTime d) => DateFormat('HH:mm').format(d);

String km(int? metros) => metros == null ? '—' : '${(metros / 1000).toStringAsFixed(1)} km';

String duracion(int? s) {
  if (s == null) return '—';
  final h = s ~/ 3600;
  final m = ((s % 3600) / 60).round();
  return h > 0 ? '$h h $m min' : '$m min';
}

const iconosVehiculo = {
  'auto': Icons.directions_car,
  'moto': Icons.two_wheeler,
  'bicicleta': Icons.pedal_bike,
  'furgoneta': Icons.airport_shuttle,
  'otro': Icons.local_shipping,
};

const coloresEstadoParada = {
  'pendiente': Color(0xFF2B6CB0),
  'completada': Color(0xFF2F855A),
  'incidencia': Color(0xFFC05621),
};

const etiquetasEstadoRuta = {
  'planificada': 'Planificada',
  'en_curso': 'En curso',
  'finalizada': 'Finalizada',
};

/// Teléfono peruano para WhatsApp: 987654321 → 51987654321.
String? telefonoWhatsApp(String? tel) {
  if (tel == null) return null;
  final d = tel.replaceAll(RegExp(r'\D'), '');
  if (d.length == 9 && d.startsWith('9')) return '51$d';
  if (d.length == 11 && d.startsWith('51')) return d;
  return d.length >= 9 ? d : null;
}

/// Decodifica una polilínea de Google (Routes API) a puntos del mapa.
List<LatLng> decodificarPolyline(String codificada) {
  final puntos = <LatLng>[];
  var i = 0, lat = 0, lng = 0;
  int leer() {
    var resultado = 0, desplazamiento = 0, b = 0;
    do {
      b = codificada.codeUnitAt(i++) - 63;
      resultado |= (b & 0x1f) << desplazamiento;
      desplazamiento += 5;
    } while (b >= 0x20);
    return (resultado & 1) != 0 ? ~(resultado >> 1) : (resultado >> 1);
  }

  while (i < codificada.length) {
    lat += leer();
    lng += leer();
    puntos.add(LatLng(lat / 1e5, lng / 1e5));
  }
  return puntos;
}
