# Logística JStore — App de conductores y auxiliares (Flutter)

App Android (y iOS) para quienes salen a ruta. Usa la misma API que la web.

## Qué hace
- **Login** solo para perfiles *Conductor* y *Auxiliar logístico* (sesión guardada de forma segura).
- **Mis rutas** del día (o de otro día): Ruta N, vehículo, avance y monto por cobrar.
- **Ruta**: botón *Iniciar ruta* y pestañas **Paradas**, **Mapa** (OpenStreetMap, sin clave de Google) y **Chat** con logística.
- **Parada**: dirección, referencia, productos, cobro; botones **Google Maps**, **Waze**, **Llamar**, **WhatsApp**;
  **Entregado / Recogido** (confirma el cobro) e **Incidencia** (motivos rápidos).
- **GPS**: con la ruta *en curso* envía la ubicación cada 30 s, también en segundo plano (notificación fija de Android).
  Se detiene al finalizar la ruta.

## Desarrollo
```bash
flutter pub get
flutter run                                                    # contra la API de producción
flutter run --dart-define=API_URL=http://10.0.2.2:4000/api     # emulador + API local (npm run dev en LogisticaBack)
flutter test
```
En emuladores con problemas de gráficos, iniciarlo con `-gpu swiftshader_indirect`.

## Generar el APK para los celulares
```bash
flutter build apk --release --split-per-abi
```
Instalar en los celulares `build/app/outputs/flutter-apk/app-arm64-v8a-release.apk` (la mayoría de celulares actuales;
para equipos muy antiguos, `app-armeabi-v7a-release.apk`). Hay que permitir "instalar apps de fuentes desconocidas".

## Clave de firma (¡importante!)
La versión release se firma con `android/app/upload-keystore.jks` y su contraseña está en `android/key.properties`.
**Ninguno de los dos se sube a GitHub.** Guárdalos en un lugar seguro (por ejemplo, un gestor de contraseñas o
un USB): sin ellos no se pueden instalar actualizaciones encima de la app existente.
