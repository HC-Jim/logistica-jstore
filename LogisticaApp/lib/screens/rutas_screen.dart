import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../models/modelos.dart';
import '../services/gps_service.dart';
import '../services/rutas_service.dart';
import '../utils/formato.dart';
import '../services/notificaciones_service.dart';
import 'login_screen.dart';
import 'notificaciones_screen.dart';
import 'ruta_screen.dart';

/// Rutas del día asignadas al conductor o auxiliar.
class RutasScreen extends StatefulWidget {
  const RutasScreen({super.key});

  @override
  State<RutasScreen> createState() => _RutasScreenState();
}

class _RutasScreenState extends State<RutasScreen> {
  String _fecha = hoyLima();
  RutasDelDia? _datos;
  String? _error;
  bool _cargando = true;
  int _noLeidas = 0;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    try {
      final d = await RutasService.misRutas(_fecha);
      setState(() {
        _datos = d;
        _error = null;
      });
      _contarAvisos();
    } on ApiException catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  Future<void> _contarAvisos() async {
    try {
      final n = await NotificacionesService.contador();
      if (mounted) setState(() => _noLeidas = n);
    } on ApiException {
      // el contador no es crítico
    }
  }

  Future<void> _abrirAvisos() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificacionesScreen()));
    _cargar();
  }

  void _moverDia(int dias) {
    final d = DateTime.parse(_fecha).add(Duration(days: dias));
    setState(() => _fecha = DateFormat('yyyy-MM-dd').format(d));
    _cargar();
  }

  Future<void> _salir() async {
    gps.detener();
    await api.cerrarSesion();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final nombre = api.usuario?['nombre'] ?? '';
    final esHoy = _fecha == hoyLima();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mis rutas'),
        actions: [
          IconButton(
            tooltip: 'Notificaciones',
            onPressed: _abrirAvisos,
            icon: Badge(
              isLabelVisible: _noLeidas > 0,
              label: Text(_noLeidas > 99 ? '99+' : '$_noLeidas'),
              child: const Icon(Icons.notifications_outlined),
            ),
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _cargar, tooltip: 'Actualizar'),
          PopupMenuButton<String>(
            onSelected: (_) => _salir(),
            itemBuilder: (_) => [
              PopupMenuItem(enabled: false, child: Text('$nombre · ${api.usuario?['rol'] == 'auxiliar' ? 'Auxiliar' : 'Conductor'}')),
              const PopupMenuItem(value: 'salir', child: Text('Cerrar sesión')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Material(
            color: Colors.grey.shade100,
            child: Row(
              children: [
                IconButton(icon: const Icon(Icons.chevron_left), onPressed: () => _moverDia(-1)),
                Expanded(
                  child: Text(
                    esHoy ? 'Hoy · ${fechaLegible(_fecha)}' : fechaLegible(_fecha),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                IconButton(icon: const Icon(Icons.chevron_right), onPressed: () => _moverDia(1)),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _cargar,
              child: _contenido(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _contenido() {
    if (_cargando && _datos == null) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return ListView(children: [
        Padding(
          padding: const EdgeInsets.all(24),
          child: Column(children: [
            Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 12),
            FilledButton(onPressed: _cargar, child: const Text('Reintentar')),
          ]),
        ),
      ]);
    }
    final rutas = _datos?.rutas ?? [];
    if (rutas.isEmpty) {
      return ListView(children: const [
        Padding(
          padding: EdgeInsets.all(32),
          child: Column(children: [
            Icon(Icons.event_available, size: 64, color: Colors.grey),
            SizedBox(height: 12),
            Text('No tienes rutas asignadas para este día.', textAlign: TextAlign.center),
          ]),
        ),
      ]);
    }
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: rutas.length,
      itemBuilder: (_, i) => _TarjetaRuta(
        ruta: rutas[i],
        onTap: () async {
          await Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => RutaScreen(rutaId: rutas[i].id, fecha: _fecha, deposito: _datos!.deposito),
          ));
          _cargar();
        },
      ),
    );
  }
}

class _TarjetaRuta extends StatelessWidget {
  const _TarjetaRuta({required this.ruta, required this.onTap});
  final Ruta ruta;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final total = ruta.paradas.length;
    final soyAuxiliar = api.usuarioId != null && ruta.conductorId != api.usuarioId;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Text('Ruta ${ruta.numero}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                const Spacer(),
                Chip(label: Text(etiquetasEstadoRuta[ruta.estado] ?? ruta.estado), visualDensity: VisualDensity.compact),
              ]),
              Row(children: [
                Icon(iconosVehiculo[ruta.vehiculoTipo] ?? Icons.local_shipping, size: 20),
                const SizedBox(width: 6),
                Text([ruta.vehiculoNombre ?? 'Sin vehículo', if (ruta.vehiculoPlaca != null) ruta.vehiculoPlaca].join(' · ')),
              ]),
              const SizedBox(height: 4),
              Text(soyAuxiliar
                  ? 'Vas como auxiliar · Conductor: ${ruta.conductorNombre ?? '—'}'
                  : 'Conductor${ruta.auxiliarNombre != null ? ' · Auxiliar: ${ruta.auxiliarNombre}' : ' (sin auxiliar)'}'),
              const SizedBox(height: 10),
              LinearProgressIndicator(value: total == 0 ? 0 : ruta.atendidas / total, minHeight: 8, borderRadius: BorderRadius.circular(4)),
              const SizedBox(height: 6),
              Text('${ruta.atendidas} de $total paradas atendidas'
                  '${ruta.aCobrar > 0 ? ' · Por cobrar ${soles(ruta.aCobrar)}' : ''}'),
            ],
          ),
        ),
      ),
    );
  }
}
