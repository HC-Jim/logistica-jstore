import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../config.dart';
import '../models/modelos.dart';
import '../services/rutas_service.dart';
import '../utils/formato.dart';

/// Chat de la ruta con logística (el mismo que se ve en la web).
class ChatView extends StatefulWidget {
  const ChatView({super.key, required this.rutaId});
  final int rutaId;

  @override
  State<ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends State<ChatView> with AutomaticKeepAliveClientMixin {
  final _mensajes = <Mensaje>[];
  final _texto = TextEditingController();
  final _scroll = ScrollController();
  Timer? _timer;
  bool _enviando = false;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _traer();
    _timer = Timer.periodic(intervaloChat, (_) => _traer());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _texto.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _traer() async {
    try {
      final despues = _mensajes.isEmpty ? 0 : _mensajes.last.id;
      final nuevos = await RutasService.mensajes(widget.rutaId, despues: despues);
      if (!mounted || nuevos.isEmpty) return;
      setState(() => _mensajes.addAll(nuevos.where((n) => !_mensajes.any((m) => m.id == n.id))));
      _bajar();
    } catch (_) {
      // sin conexión: se reintenta en el siguiente ciclo
    }
  }

  void _bajar() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  Future<void> _enviar() async {
    final texto = _texto.text.trim();
    if (texto.isEmpty) return;
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      final m = await RutasService.enviarMensaje(widget.rutaId, texto);
      _texto.clear();
      setState(() {
        if (!_mensajes.any((x) => x.id == m.id)) _mensajes.add(m);
      });
      _bajar();
    } on ApiException catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Column(children: [
      Expanded(
        child: _mensajes.isEmpty
            ? const Center(child: Text('Sin mensajes. Escribe a logística si necesitas algo.'))
            : ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.all(12),
                itemCount: _mensajes.length,
                itemBuilder: (_, i) {
                  final m = _mensajes[i];
                  final mio = m.usuarioId == api.usuarioId;
                  return Align(
                    alignment: mio ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: mio ? Colors.blue.shade50 : Colors.white,
                        border: Border.all(color: mio ? Colors.blue.shade100 : Colors.grey.shade300),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (!mio) Text(m.usuarioNombre, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                        Text(m.texto),
                        Align(alignment: Alignment.bottomRight, child: Text(hora(m.creadoEn), style: const TextStyle(fontSize: 11, color: Colors.grey))),
                      ]),
                    ),
                  );
                },
              ),
      ),
      if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
      SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _texto,
                minLines: 1,
                maxLines: 4,
                maxLength: 2000,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(hintText: 'Mensaje para logística…', border: OutlineInputBorder(), counterText: ''),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(onPressed: _enviando ? null : _enviar, icon: const Icon(Icons.send)),
          ]),
        ),
      ),
    ]);
  }
}
