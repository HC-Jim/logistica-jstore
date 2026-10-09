import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api/api_client.dart';
import '../services/notificaciones_service.dart';
import '../services/rutas_service.dart';
import 'ruta_screen.dart';

const _iconos = {
  'ruta_asignada': Icons.route,
  'ruta_retirada': Icons.block,
  'ruta_modificada': Icons.sync,
  'mensaje': Icons.chat_bubble_outline,
  'incidencia': Icons.warning_amber,
  'pedido_modificado': Icons.edit_note,
  'pedido_retirado': Icons.cancel_outlined,
};

/// Abre la ruta del aviso (o su chat). Sirve para la bandeja y para los avisos push,
/// cuyos datos llegan como texto.
Future<void> abrirRutaDeAviso(BuildContext context, Map<String, dynamic> datos) async {
  final rutaId = int.tryParse('${datos['ruta_id'] ?? ''}');
  final fecha = datos['fecha'] == null ? null : '${datos['fecha']}'.substring(0, 10);
  if (rutaId == null || fecha == null || datos['tipo'] == 'ruta_retirada') return;
  final mensajero = ScaffoldMessenger.of(context);
  final navegador = Navigator.of(context);
  try {
    final dia = await RutasService.misRutas(fecha);
    if (!dia.rutas.any((r) => r.id == rutaId)) {
      mensajero.showSnackBar(const SnackBar(content: Text('Esa ruta ya no está asignada a ti.')));
      return;
    }
    await navegador.push(MaterialPageRoute(
      builder: (_) => RutaScreen(rutaId: rutaId, fecha: fecha, deposito: dia.deposito, pestana: datos['abrir'] == 'chat' ? 2 : 0),
    ));
  } on ApiException catch (e) {
    mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
  }
}

/// Bandeja de avisos: rutas asignadas, cambios, pedidos retirados y mensajes.
class NotificacionesScreen extends StatefulWidget {
  const NotificacionesScreen({super.key});

  @override
  State<NotificacionesScreen> createState() => _NotificacionesScreenState();
}

class _NotificacionesScreenState extends State<NotificacionesScreen> {
  List<Aviso>? _avisos;
  int _noLeidas = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    try {
      final (n, lista) = await NotificacionesService.listar();
      setState(() {
        _noLeidas = n;
        _avisos = lista;
        _error = null;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.mensaje);
    }
  }

  Future<void> _leerTodas() async {
    try {
      await NotificacionesService.leerTodas();
      setState(() {
        _noLeidas = 0;
        for (final a in _avisos ?? <Aviso>[]) {
          a.leida = true;
        }
      });
    } on ApiException catch (e) {
      _mostrar(e.mensaje);
    }
  }

  Future<void> _abrir(Aviso a) async {
    if (!a.leida) {
      NotificacionesService.leer([a.id]).ignore();
      setState(() {
        a.leida = true;
        _noLeidas = (_noLeidas - 1).clamp(0, 9999);
      });
    }
    await abrirRutaDeAviso(context, {...a.datos, 'tipo': a.tipo});
  }

  void _mostrar(String texto) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notificaciones'),
        actions: [
          if (_noLeidas > 0) TextButton(onPressed: _leerTodas, child: const Text('Marcar todas leídas')),
        ],
      ),
      body: RefreshIndicator(onRefresh: _cargar, child: _contenido()),
    );
  }

  Widget _contenido() {
    if (_error != null) {
      return ListView(children: [
        Padding(padding: const EdgeInsets.all(24), child: Text(_error!, style: const TextStyle(color: Colors.red))),
      ]);
    }
    final avisos = _avisos;
    if (avisos == null) return const Center(child: CircularProgressIndicator());
    if (avisos.isEmpty) {
      return ListView(children: const [
        Padding(
          padding: EdgeInsets.all(32),
          child: Column(children: [
            Icon(Icons.notifications_none, size: 64, color: Colors.grey),
            SizedBox(height: 12),
            Text('No tienes notificaciones.'),
          ]),
        ),
      ]);
    }
    final formato = DateFormat('dd/MM HH:mm');
    return ListView.separated(
      itemCount: avisos.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final a = avisos[i];
        return ListTile(
          tileColor: a.leida ? null : Colors.blue.shade50,
          leading: Icon(_iconos[a.tipo] ?? Icons.notifications, color: a.tipo == 'pedido_retirado' ? Colors.red : null),
          title: Text(a.titulo, style: TextStyle(fontWeight: a.leida ? FontWeight.normal : FontWeight.bold)),
          subtitle: Text([if (a.cuerpo != null) a.cuerpo!, formato.format(a.creadoEn)].join('\n')),
          isThreeLine: a.cuerpo != null,
          onTap: () => _abrir(a),
        );
      },
    );
  }
}
