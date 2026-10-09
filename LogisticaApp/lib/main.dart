import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'api/api_client.dart';
import 'screens/login_screen.dart';
import 'screens/notificaciones_screen.dart';
import 'screens/rutas_screen.dart';
import 'services/gps_service.dart';
import 'services/push_service.dart';

final navegador = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('es');
  await api.cargarSesion();
  // Si el token vence, se vuelve al login
  api.onSesionExpirada = () {
    gps.detener();
    navegador.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen(mensaje: 'Tu sesión venció. Ingresa de nuevo.')),
      (_) => false,
    );
  };
  await push.iniciar();
  push.onAbrir = (datos) {
    final ctx = navegador.currentContext;
    if (ctx != null && api.tieneSesion) abrirRutaDeAviso(ctx, datos);
  };
  runApp(const LogisticaApp());
}

const colorPrimario = Color(0xFF2B6CB0);
const colorOscuro = Color(0xFF1A202C);

class LogisticaApp extends StatelessWidget {
  const LogisticaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Logística JStore',
      navigatorKey: navegador,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: colorPrimario, primary: colorPrimario),
        appBarTheme: const AppBarTheme(backgroundColor: colorOscuro, foregroundColor: Colors.white),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(minimumSize: const Size(48, 52), textStyle: const TextStyle(fontSize: 16)),
        ),
        useMaterial3: true,
      ),
      home: api.tieneSesion ? const RutasScreen() : const LoginScreen(),
    );
  }
}
