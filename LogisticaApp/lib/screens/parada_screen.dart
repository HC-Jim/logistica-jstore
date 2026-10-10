import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../models/modelos.dart';
import '../services/rutas_service.dart';
import '../utils/formato.dart';

const motivosIncidencia = [
  'Cliente no contesta',
  'Cliente ausente',
  'Dirección incorrecta o no ubicada',
  'Cliente rechazó el pedido',
  'Producto dañado',
  'No tenía para pagar',
  'Zona peligrosa / sin acceso',
];

/// Detalle de una parada: a quién, dónde, qué y cuánto cobrar; y marcarla como atendida.
class ParadaScreen extends StatefulWidget {
  const ParadaScreen({super.key, required this.parada, required this.rutaFinalizada});
  final Parada parada;
  final bool rutaFinalizada;

  @override
  State<ParadaScreen> createState() => _ParadaScreenState();
}

class _ParadaScreenState extends State<ParadaScreen> {
  bool _enviando = false;

  Parada get p => widget.parada;

  Future<void> _abrir(Uri uri) async {
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No se pudo abrir la aplicación')));
    }
  }

  void _navegar(String app) {
    final destino = p.punto;
    if (destino == null) return;
    _abrir(app == 'waze'
        ? Uri.parse('https://waze.com/ul?ll=${destino.latitude},${destino.longitude}&navigate=yes')
        : Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${destino.latitude},${destino.longitude}&travelmode=driving'));
  }

  // Foto de la entrega: se toma y se sube antes de marcar "Entregado"
  Uint8List? _foto;
  bool _subiendo = false;
  bool _fotoSubida = false;
  String? _errorFoto;

  /// Abre la cámara y sube la foto. Devuelve true si quedó subida.
  Future<bool> _tomarFoto() async {
    final XFile? archivo;
    try {
      // tamaño moderado: se ve bien y sube rápido con datos móviles
      archivo = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1280, maxHeight: 1280, imageQuality: 70);
    } catch (_) {
      _mensaje('No se pudo abrir la cámara. Revisa el permiso de cámara de la app.');
      return false;
    }
    if (archivo == null) return false; // canceló
    final bytes = await archivo.readAsBytes();
    setState(() {
      _foto = bytes;
      _fotoSubida = false;
    });
    return _subirFoto();
  }

  /// Sube la foto ya tomada (también sirve para reintentar si falló la conexión).
  Future<bool> _subirFoto() async {
    final foto = _foto;
    if (foto == null) return false;
    setState(() {
      _subiendo = true;
      _errorFoto = null;
    });
    try {
      await RutasService.subirFoto(p.id, foto);
      if (mounted) setState(() => _fotoSubida = true);
      return true;
    } on ApiException catch (e) {
      if (mounted) setState(() => _errorFoto = e.mensaje);
      return false;
    } finally {
      if (mounted) setState(() => _subiendo = false);
    }
  }

  void _mensaje(String texto) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  Future<void> _completar() async {
    // Los pedidos necesitan la foto del cliente con el producto; las acciones (Falabella, almacén...) no
    if (!p.esAccion && !_fotoSubida) {
      final ok = _foto == null ? await _tomarFoto() : await _subirFoto();
      if (!ok) {
        if (_errorFoto != null) _mensaje('No se pudo subir la foto: $_errorFoto');
        return;
      }
    }
    if (!mounted) return;
    final foto = _foto;
    final confirmado = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('¿Marcar como ${p.verboCompletar.toLowerCase()}?'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (foto != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(foto, height: 180, fit: BoxFit.cover)),
            ),
          Text(p.titulo, style: const TextStyle(fontWeight: FontWeight.bold)),
          if (p.cobra) ...[
            const SizedBox(height: 12),
            Text('¿Cobraste ${soles(p.totalPedido)}${p.medioPago != null ? ' por ${p.medioPago}' : ''}?',
                style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w600)),
          ],
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text('Sí, ${p.verboCompletar.toLowerCase()}')),
        ],
      ),
    );
    if (confirmado == true) await _enviar('completada');
  }

  /// Tarjeta con el botón de la cámara, la vista previa y el estado de la subida.
  Widget _tarjetaFoto() {
    final foto = _foto;
    return Card(
      color: _fotoSubida ? Colors.green.shade50 : Colors.amber.shade50,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.photo_camera_outlined),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Foto de la entrega (obligatoria)', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            if (_fotoSubida) const Icon(Icons.check_circle, color: Color(0xFF2F855A)),
          ]),
          const SizedBox(height: 4),
          Text(p.esRecojo ? 'Foto de lo que recoges, con el cliente si es posible.' : 'Foto del cliente recibiendo el producto.'),
          const SizedBox(height: 10),
          if (foto != null) ...[
            ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(foto, height: 180, width: double.infinity, fit: BoxFit.cover)),
            const SizedBox(height: 8),
            if (_subiendo) const Row(children: [SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)), SizedBox(width: 8), Text('Subiendo foto…')]),
            if (_fotoSubida) const Text('✔ Foto guardada. Ya puedes marcar la entrega.', style: TextStyle(color: Color(0xFF2F855A), fontWeight: FontWeight.w600)),
            if (_errorFoto != null) Text('✖ No se pudo subir: $_errorFoto', style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (foto == null)
              FilledButton.icon(onPressed: _subiendo || _enviando ? null : _tomarFoto, icon: const Icon(Icons.photo_camera), label: const Text('Tomar foto'))
            else ...[
              OutlinedButton.icon(onPressed: _subiendo || _enviando ? null : _tomarFoto, icon: const Icon(Icons.refresh), label: const Text('Volver a tomar')),
              if (_errorFoto != null)
                FilledButton.icon(onPressed: _subiendo ? null : _subirFoto, icon: const Icon(Icons.cloud_upload), label: const Text('Reintentar subida')),
            ],
          ]),
        ]),
      ),
    );
  }

  Future<void> _incidencia() async {
    final nota = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _HojaIncidencia(),
    );
    if (nota != null && nota.isNotEmpty) await _enviar('incidencia', nota: nota);
  }

  Future<void> _enviar(String estado, {String? nota}) async {
    setState(() => _enviando = true);
    try {
      await RutasService.atender(p.id, estado, nota: nota);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(estado == 'completada' ? '✔ ${p.verboCompletar}' : 'Incidencia registrada'),
      ));
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tel = p.clienteTelefono;
    final wa = telefonoWhatsApp(tel);
    final puedeMarcar = p.pendiente && !widget.rutaFinalizada;
    return Scaffold(
      appBar: AppBar(title: Text(p.esAccion ? 'Acción' : 'Pedido #${p.pedidoId}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!p.pendiente)
            Card(
              color: switch (p.estado) { 'completada' => Colors.green.shade50, 'cancelada' => Colors.red.shade50, _ => Colors.orange.shade50 },
              child: Column(children: [
                ListTile(
                  leading: Icon(
                    switch (p.estado) { 'completada' => Icons.check_circle, 'cancelada' => Icons.cancel, _ => Icons.report },
                    color: coloresEstadoParada[p.estado],
                  ),
                  title: Text(
                    '${switch (p.estado) { 'completada' => p.verboCompletar, 'cancelada' => 'Cancelado por logística: no lo entregues', _ => 'Incidencia' }}'
                    '${p.atendidaEn != null ? ' · ${hora(p.atendidaEn!)}' : ''}',
                  ),
                  subtitle: p.nota != null ? Text(p.nota!) : null,
                ),
                if (p.fotoUrl != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(urlArchivo(p.fotoUrl!), height: 200, fit: BoxFit.cover)),
                  ),
              ]),
            ),
          Text(p.titulo, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
          if (p.tipoPedido != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Wrap(spacing: 6, children: [
                Chip(label: Text(p.tipoPedido!)),
                if (p.esRecojo) const Chip(label: Text('⬆ RECOGER'), backgroundColor: Color(0xFFE9D8FD)),
                if (p.categoria == 'encargo') const Chip(label: Text('🏢 Encargo')),
                if (p.categoria == 'inversa') const Chip(label: Text('↩️ Logística inversa')),
                if (p.despachado) const Chip(label: Text('📦 Despachado')),
              ]),
            ),
          if (p.motivo != null) Text('Motivo: ${p.motivo}'),
          const SizedBox(height: 12),
          if (puedeMarcar && !p.esAccion) _tarjetaFoto(),

          // Dirección y acciones de contacto
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Icon(Icons.place_outlined),
                  const SizedBox(width: 8),
                  Expanded(child: Text([p.direccion, p.detalleDomicilio, p.distrito].whereType<String>().join(', '),
                      style: const TextStyle(fontSize: 16))),
                ]),
                if (p.referencia != null) Padding(padding: const EdgeInsets.only(left: 32, top: 4), child: Text('Ref: ${p.referencia}')),
                if (p.agencia != null) Padding(padding: const EdgeInsets.only(left: 32, top: 4), child: Text('Agencia: ${p.agencia}')),
                const SizedBox(height: 12),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  if (p.punto != null) FilledButton.icon(onPressed: () => _navegar('google'), icon: const Icon(Icons.navigation), label: const Text('Google Maps')),
                  if (p.punto != null) OutlinedButton.icon(onPressed: () => _navegar('waze'), icon: const Icon(Icons.directions_car), label: const Text('Waze')),
                  if (tel != null) OutlinedButton.icon(onPressed: () => _abrir(Uri(scheme: 'tel', path: tel)), icon: const Icon(Icons.call), label: Text(tel)),
                  if (wa != null) OutlinedButton.icon(onPressed: () => _abrir(Uri.parse('https://wa.me/$wa')), icon: const Icon(Icons.chat), label: const Text('WhatsApp')),
                ]),
                if (p.punto == null) const Text('⚠ Este pedido no tiene ubicación en el mapa', style: TextStyle(color: Colors.red)),
              ]),
            ),
          ),

          // Qué se entrega / recoge
          if (p.items.isNotEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.esRecojo ? 'Recoger' : 'Entregar', style: const TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 6),
                  for (final it in p.items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(children: [
                        CircleAvatar(radius: 14, child: Text('${it.cantidad}', style: const TextStyle(fontSize: 12))),
                        const SizedBox(width: 10),
                        Expanded(child: Text(it.descripcion)),
                      ]),
                    ),
                ]),
              ),
            ),

          // Cobro
          if (!p.esAccion)
            Card(
              color: p.cobra ? Colors.red.shade50 : null,
              child: ListTile(
                leading: Icon(Icons.payments_outlined, color: p.cobra ? Colors.red : null),
                title: Text(p.cobra ? '${p.cobrar}: ${soles(p.totalPedido)}' : 'No cobrar',
                    style: TextStyle(fontWeight: FontWeight.bold, color: p.cobra ? Colors.red : null)),
                subtitle: Text([p.medioPago, if (p.documentoBsale != null) 'Doc. ${p.documentoBsale}'].whereType<String>().join(' · ')),
              ),
            ),
          if (p.notaPedido != null)
            Card(child: ListTile(leading: const Icon(Icons.sticky_note_2_outlined), title: const Text('Nota'), subtitle: Text(p.notaPedido!))),
          const SizedBox(height: 90),
        ],
      ),
      bottomNavigationBar: puedeMarcar
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(children: [
                  Expanded(
                    flex: 2,
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(minimumSize: const Size(48, 52), foregroundColor: Colors.deepOrange),
                      onPressed: _enviando ? null : _incidencia,
                      icon: const Icon(Icons.report_problem_outlined),
                      label: const Text('Incidencia'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 3,
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: const Color(0xFF2F855A)),
                      onPressed: _enviando || _subiendo ? null : _completar,
                      icon: Icon(p.esAccion || _fotoSubida ? Icons.check : Icons.photo_camera),
                      label: Text(_enviando ? 'Enviando…' : p.verboCompletar),
                    ),
                  ),
                ]),
              ),
            )
          : null,
    );
  }
}

/// Elegir el motivo de la incidencia (o escribirlo).
class _HojaIncidencia extends StatefulWidget {
  const _HojaIncidencia();

  @override
  State<_HojaIncidencia> createState() => _HojaIncidenciaState();
}

class _HojaIncidenciaState extends State<_HojaIncidencia> {
  final _texto = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('¿Qué pasó?', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 4, children: [
          for (final m in motivosIncidencia)
            ActionChip(label: Text(m), onPressed: () => setState(() => _texto.text = m)),
        ]),
        const SizedBox(height: 8),
        TextField(
          controller: _texto,
          maxLines: 2,
          maxLength: 500,
          decoration: const InputDecoration(labelText: 'Detalle', border: OutlineInputBorder()),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Colors.deepOrange),
          onPressed: () => Navigator.pop(context, _texto.text.trim()),
          child: const Text('Registrar incidencia'),
        ),
      ]),
    );
  }
}
