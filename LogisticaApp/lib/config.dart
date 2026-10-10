/// URL del backend. Se puede cambiar al compilar:
///   flutter run --dart-define=API_URL=http://192.168.1.10:4000/api
const String apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://logistica-api-alpha.vercel.app/api',
);

/// Cada cuánto se envía la ubicación GPS mientras la ruta está en curso.
const Duration intervaloGps = Duration(seconds: 10);

/// Sin ruta en curso (en turno) la ubicación se envía con menos frecuencia para cuidar la batería.
const Duration intervaloGpsTurno = Duration(seconds: 60);

/// Cada cuánto se consultan mensajes nuevos del chat.
const Duration intervaloChat = Duration(seconds: 5);
