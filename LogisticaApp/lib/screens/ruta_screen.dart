import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/modelos.dart';
import '../services/gps_service.dart';
import '../services/push_service.dart';
import '../services/rutas_service.dart';
import '../utils/formato.dart';
import '../widgets/chat_view.dart';
import '../widgets/mapa_ruta.dart';
import 'parada_screen.dart';

/// Una ruta: paradas, mapa y chat con logística.
class RutaScreen extends StatefulWidget {
  const RutaScreen({super.key, required this.rutaId, required this.fecha, required this.deposito, this.pestana = 0});
  final int rutaId;
  final String fecha;
  final Deposito deposito;
  final int pestana; // 0 paradas, 1 mapa, 2 chat

  @override
  State<RutaScreen> createState() => _RutaScreenState();
}

class _RutaScreenState extends State<RutaScreen> {
  Ruta? _ruta;
  String? _error;
  bool _iniciando = false;

  @override
  void initState() {
    super.initState();
    gps.addListener(_alCambiarGps);
    push.llegadas.addListener(_cargar); // p. ej. logística canceló o agregó un pedido
    _cargar();
  }

  @override
  void dispose() {
    gps.removeListener(_alCambiarGps);
    push.llegadas.removeListener(_cargar);
    super.dispose();
  }

  void _alCambiarGps() => mounted ? setState(() {}) : null;

  Future<void> _cargar() async {
    try {
      final d = await RutasService.misRutas(widget.fecha);
      final ruta = d.rutas.where((r) => r.id == widget.rutaId).firstOrNull;
      if (!mounted) return;
      setState(() {
        _ruta = ruta;
        _error = ruta == null ? 'Esta ruta ya no está asignada a ti.' : null;
      });
      // La ruta en curso comparte la ubicación automáticamente; al finalizar se deja de compartir
      if (ruta != null && ruta.estado == 'en_curso' && !gps.activo) await _activarGps(ruta.id);
      if (ruta != null && ruta.finalizada && gps.rutaId == ruta.id) gps.detener();
    } on ApiException catch (e) {
      setState(() => _error = e.mensaje);
    }
  }

  Future<void> _activarGps(int rutaId) async {
    final problema = await gps.iniciar(rutaId);
    if (problema != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problema), duration: const Duration(seconds: 6)));
    }
  }

  Future<void> _iniciar() async {
    setState(() => _iniciando = true);
    try {
      await RutasService.iniciar(widget.rutaId);
      await _cargar(); // al quedar "en curso" activa el GPS
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
    } finally {
      if (mounted) setState(() => _iniciando = false);
    }
  }

  Future<void> _finalizar() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Llegaste al almacén?'),
        content: const Text('La ruta se dará por terminada y dejarás de compartir tu ubicación.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Todavía no')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sí, finalizar')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await RutasService.finalizar(widget.rutaId);
      await _cargar(); // al quedar finalizada se apaga el GPS
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }

  Future<void> _abrirParada(Parada p) async {
    final cambio = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => ParadaScreen(parada: p, rutaFinalizada: _ruta!.finalizada),
    ));
    if (cambio == true) await _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final ruta = _ruta;
    return DefaultTabController(
      length: 3,
      initialIndex: widget.pestana,
      child: Scaffold(
        appBar: AppBar(
          title: Text(ruta == null ? 'Ruta' : 'Ruta ${ruta.numero}'),
          actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _cargar)],
          bottom: const TabBar(
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white70,
            indicatorColor: Colors.white,
            tabs: [
              Tab(icon: Icon(Icons.format_list_numbered), text: 'Paradas'),
              Tab(icon: Icon(Icons.map_outlined), text: 'Mapa'),
              Tab(icon: Icon(Icons.chat_outlined), text: 'Chat'),
            ],
          ),
        ),
        body: ruta == null
            ? Center(child: _error != null ? Text(_error!, style: const TextStyle(color: Colors.red)) : const CircularProgressIndicator())
            : Column(
                children: [
                  _Encabezado(ruta: ruta, iniciando: _iniciando, onIniciar: _iniciar, onActivarGps: () => _activarGps(ruta.id), onFinalizar: _finalizar),
                  Expanded(
                    child: TabBarView(
                      physics: const NeverScrollableScrollPhysics(), // el mapa usa los gestos
                      children: [
                        RefreshIndicator(onRefresh: _cargar, child: _ListaParadas(ruta: ruta, onTap: _abrirParada)),
                        MapaRuta(ruta: ruta, deposito: widget.deposito, onTapParada: _abrirParada, onRecargar: _cargar),
                        ChatView(rutaId: ruta.id),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _Encabezado extends StatelessWidget {
  const _Encabezado({required this.ruta, required this.iniciando, required this.onIniciar, required this.onActivarGps, required this.onFinalizar});
  final Ruta ruta;
  final bool iniciando;
  final VoidCallback onIniciar;
  final VoidCallback onActivarGps;
  final VoidCallback onFinalizar;

  @override
  Widget build(BuildContext context) {
    final total = ruta.paradas.length;
    return Material(
      color: Colors.blue.shade50,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(iconosVehiculo[ruta.vehiculoTipo] ?? Icons.local_shipping, size: 20),
              const SizedBox(width: 6),
              Expanded(child: Text(ruta.vehiculoNombre ?? 'Sin vehículo', style: const TextStyle(fontWeight: FontWeight.w600))),
              Text('${ruta.atendidas}/$total · ${etiquetasEstadoRuta[ruta.estado]}'),
            ]),
            if (ruta.aCobrar > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('💵 Por cobrar en la ruta: ${soles(ruta.aCobrar)}', style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.red)),
              ),
            const SizedBox(height: 8),
            if (ruta.estado == 'planificada')
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: iniciando ? null : onIniciar,
                  icon: const Icon(Icons.play_arrow),
                  label: Text(iniciando ? 'Iniciando…' : 'Iniciar ruta'),
                ),
              )
            else if (ruta.estado == 'en_curso')
              Row(children: [
                Icon(gps.activo ? Icons.gps_fixed : Icons.gps_off, size: 18, color: gps.activo ? Colors.green : Colors.red),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    gps.activo
                        ? (gps.error ?? (gps.ultimoEnvio == null ? 'Compartiendo ubicación…' : 'Ubicación compartida a las ${hora(gps.ultimoEnvio!)}'))
                        : 'No estás compartiendo tu ubicación',
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
                if (!gps.activo) TextButton(onPressed: onActivarGps, child: const Text('Activar')),
              ])
            else
              const Text('✔ Ruta finalizada', style: TextStyle(color: Colors.green, fontWeight: FontWeight.w600)),
            if (ruta.estado == 'en_curso' && ruta.siguiente == null) ...[
              const SizedBox(height: 6),
              const Text('🏁 Todas las paradas atendidas: vuelve al almacén (la ruta se cierra sola al llegar).'),
              const SizedBox(height: 6),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(onPressed: onFinalizar, icon: const Icon(Icons.warehouse), label: const Text('Llegué al almacén · Finalizar ruta')),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ListaParadas extends StatelessWidget {
  const _ListaParadas({required this.ruta, required this.onTap});
  final Ruta ruta;
  final void Function(Parada) onTap;

  @override
  Widget build(BuildContext context) {
    final siguiente = ruta.siguiente;
    return ListView.separated(
      padding: const EdgeInsets.only(bottom: 24),
      itemCount: ruta.paradas.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final p = ruta.paradas[i];
        final color = coloresEstadoParada[p.estado] ?? Colors.grey;
        final esSiguiente = p.id == siguiente?.id && !ruta.finalizada;
        return ListTile(
          tileColor: esSiguiente ? Colors.amber.shade50 : null,
          leading: CircleAvatar(
            backgroundColor: color,
            foregroundColor: Colors.white,
            child: switch (p.estado) {
              'completada' => const Icon(Icons.check),
              'incidencia' => const Icon(Icons.priority_high),
              'cancelada' => const Icon(Icons.close),
              _ => Text('${i + 1}'),
            },
          ),
          title: Text(p.titulo, style: TextStyle(fontWeight: esSiguiente ? FontWeight.bold : FontWeight.w500)),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (esSiguiente) const Text('▶ SIGUIENTE PARADA', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, fontSize: 12)),
              if (p.esAccion) const Text('⚑ Acción', style: TextStyle(fontWeight: FontWeight.w600)),
              if (p.esRecojo) const Text('⬆ RECOGER', style: TextStyle(color: Colors.deepPurple, fontWeight: FontWeight.bold)),
              if (p.categoria == 'encargo' && !p.esRecojo) const Text('🏢 ENCARGO', style: TextStyle(color: Colors.deepOrange, fontWeight: FontWeight.bold)),
              Text([p.direccion, p.distrito].whereType<String>().join(', ')),
              if (p.cobra && p.pendiente)
                Text('💵 Cobrar ${soles(p.totalPedido)}${p.medioPago != null ? ' · ${p.medioPago}' : ''}',
                    style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w600)),
              if (p.estado == 'completada' && p.atendidaEn != null)
                Text('✔ ${p.verboCompletar} a las ${hora(p.atendidaEn!)}', style: const TextStyle(color: Color(0xFF2F855A))),
              if (p.estado == 'incidencia')
                Text('Incidencia${p.atendidaEn != null ? ' ${hora(p.atendidaEn!)}' : ''}: ${p.nota ?? ''}', style: const TextStyle(color: Colors.deepOrange)),
              if (p.estado == 'cancelada')
                Text('✖ No lo entregues — ${p.nota ?? 'retirado por logística'}',
                    style: const TextStyle(color: Color(0xFFC53030), fontWeight: FontWeight.w600)),
            ],
          ),
          isThreeLine: true,
          trailing: const Icon(Icons.chevron_right),
          onTap: () => onTap(p),
        );
      },
    );
  }
}
