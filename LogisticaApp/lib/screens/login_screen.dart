import 'package:flutter/material.dart';

import '../api/api_client.dart';
import 'rutas_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.mensaje});
  final String? mensaje;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _clave = TextEditingController();
  bool _verClave = false;
  bool _enviando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _error = widget.mensaje;
  }

  Future<void> _ingresar() async {
    if (_email.text.trim().isEmpty || _clave.text.isEmpty) {
      setState(() => _error = 'Escribe tu correo y contraseña');
      return;
    }
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await api.login(_email.text, _clave.text);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const RutasScreen()));
    } on ApiException catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A202C),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: AutofillGroup(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Icon(Icons.local_shipping, size: 56, color: Color(0xFF2B6CB0)),
                      const SizedBox(height: 8),
                      Text.rich(
                        TextSpan(children: [
                          const TextSpan(text: 'Logística', style: TextStyle(fontWeight: FontWeight.bold)),
                          TextSpan(text: 'JStore', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.blue.shade400)),
                        ]),
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 24),
                      ),
                      const Text('Conductores y auxiliares', textAlign: TextAlign.center),
                      const SizedBox(height: 24),
                      TextField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        decoration: const InputDecoration(labelText: 'Correo', prefixIcon: Icon(Icons.email_outlined), border: OutlineInputBorder()),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _clave,
                        obscureText: !_verClave,
                        autofillHints: const [AutofillHints.password],
                        onSubmitted: (_) => _ingresar(),
                        decoration: InputDecoration(
                          labelText: 'Contraseña',
                          prefixIcon: const Icon(Icons.lock_outline),
                          border: const OutlineInputBorder(),
                          suffixIcon: IconButton(
                            icon: Icon(_verClave ? Icons.visibility_off : Icons.visibility),
                            onPressed: () => setState(() => _verClave = !_verClave),
                          ),
                        ),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Text(_error!, style: const TextStyle(color: Colors.red)),
                      ],
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: _enviando ? null : _ingresar,
                        child: _enviando
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Ingresar'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
