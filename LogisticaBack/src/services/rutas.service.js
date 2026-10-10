import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MAX_PARADAS = 25; // límite de puntos intermedios de Routes API

const punto = ({ lat, lng }) => ({ location: { latLng: { latitude: lat, longitude: lng } } });
const segundos = (d) => (d ? parseInt(d, 10) : 0); // "123s" → 123

/**
 * Modo de viaje de Google según la movilidad de la ruta.
 * A pie → WALK; transporte público (bus, tren) → TRANSIT; el resto, en auto.
 */
export function modoViaje(tipoVehiculo) {
  if (tipoVehiculo === 'a_pie') return 'WALK';
  if (tipoVehiculo === 'transporte_publico') return 'TRANSIT';
  return 'DRIVE';
}

// --- polilíneas codificadas (para unir los tramos de transporte público) ---
function decodificar(texto) {
  const puntos = [];
  let i = 0, lat = 0, lng = 0;
  while (i < texto.length) {
    for (const eje of [0, 1]) {
      let r = 0, d = 0, b;
      do { b = texto.charCodeAt(i++) - 63; r |= (b & 0x1f) << d; d += 5; } while (b >= 0x20);
      const delta = r & 1 ? ~(r >> 1) : r >> 1;
      if (eje === 0) lat += delta; else lng += delta;
    }
    puntos.push([lat, lng]);
  }
  return puntos;
}
function codificar(puntos) {
  let salida = '', pLat = 0, pLng = 0;
  const num = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = '';
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of puntos) { salida += num(lat - pLat) + num(lng - pLng); pLat = lat; pLng = lng; }
  return salida;
}
const unir = (polilineas) => codificar(polilineas.filter(Boolean).flatMap(decodificar));

/** Una consulta a Routes API. */
async function consultar({ origen, destino, intermedios = [], modo = 'DRIVE', optimizar = false }) {
  if (!env.googleMapsServerKey) {
    throw new HttpError(400, 'Configura GOOGLE_MAPS_SERVER_KEY (Routes API) en el backend para trazar rutas');
  }
  if (intermedios.length > MAX_PARADAS) {
    throw new HttpError(400, `Google permite máximo ${MAX_PARADAS} paradas por ruta (hay ${intermedios.length})`);
  }
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.googleMapsServerKey,
      'X-Goog-FieldMask': [
        'routes.distanceMeters', 'routes.duration', 'routes.polyline.encodedPolyline',
        'routes.legs.distanceMeters', 'routes.legs.duration', 'routes.legs.polyline.encodedPolyline',
        'routes.optimizedIntermediateWaypointIndex',
      ].join(','),
    },
    body: JSON.stringify({
      origin: punto(origen),
      destination: punto(destino),
      ...(intermedios.length ? { intermediates: intermedios.map(punto) } : {}),
      travelMode: modo,
      ...(optimizar && intermedios.length > 1 ? { optimizeWaypointOrder: true } : {}),
      languageCode: 'es',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Routes API:', data);
    throw new HttpError(502, `Google Routes API: ${data.error?.message ?? res.statusText}`);
  }
  const ruta = data.routes?.[0];
  if (!ruta) {
    throw new HttpError(422, modo === 'TRANSIT'
      ? 'Google no encontró una ruta en transporte público entre estos puntos'
      : 'Google no encontró un camino para estas paradas');
  }
  const optimizado = ruta.optimizedIntermediateWaypointIndex;
  const legs = (ruta.legs ?? []).map((l) => ({
    distanciaMetros: l.distanceMeters ?? 0,
    duracionSegundos: segundos(l.duration),
    polyline: l.polyline?.encodedPolyline ?? null,
  }));
  return {
    orden: optimizado?.length && optimizado[0] !== -1 ? optimizado : intermedios.map((_, i) => i),
    distanciaMetros: ruta.distanceMeters ?? 0,
    duracionSegundos: segundos(ruta.duration),
    polyline: ruta.polyline?.encodedPolyline ?? null,
    legs,
  };
}

/**
 * Camino origen → paradas (en orden) → destino.
 * Transporte público no admite paradas intermedias: se calcula tramo por tramo y se unen.
 * Para optimizar el orden en transporte público se usa el orden más corto en auto.
 */
async function calcular({ origen, destino, paradas, modo, optimizar }) {
  if (modo !== 'TRANSIT' || !paradas.length) return consultar({ origen, destino, intermedios: paradas, modo, optimizar });

  const orden = optimizar && paradas.length > 1
    ? (await consultar({ origen, destino, intermedios: paradas, modo: 'DRIVE', optimizar: true })).orden
    : paradas.map((_, i) => i);
  const puntos = [origen, ...orden.map((i) => paradas[i]), destino];
  const tramos = [];
  for (let i = 0; i < puntos.length - 1; i++) {
    tramos.push(await consultar({ origen: puntos[i], destino: puntos[i + 1], modo }));
  }
  return {
    orden,
    distanciaMetros: tramos.reduce((s, t) => s + t.distanciaMetros, 0),
    duracionSegundos: tramos.reduce((s, t) => s + t.duracionSegundos, 0),
    polyline: unir(tramos.map((t) => t.polyline)),
    legs: tramos.map((t) => ({ distanciaMetros: t.distanciaMetros, duracionSegundos: t.duracionSegundos, polyline: t.polyline })),
  };
}

/**
 * Camino que le queda al conductor: desde su posición, por las paradas pendientes (en orden),
 * hasta el almacén. Devuelve el total y cada tramo (legs[0] = hasta la próxima parada).
 * Con `optimizar` Google reordena las paradas y `orden` trae los índices de `paradas`.
 */
export function trazarRestante(origen, paradas, { optimizar = false, modo = 'DRIVE' } = {}) {
  return calcular({ origen, destino: env.deposito, paradas, modo, optimizar });
}

/**
 * Traza la ruta depósito → paradas → depósito con Google Routes API.
 * Con `optimizar` Google reordena las paradas para minimizar el recorrido.
 * Devuelve el orden (índices de `paradas`), distancia, duración y polilínea.
 */
export function trazarRuta(paradas, { optimizar = false, modo = 'DRIVE' } = {}) {
  if (!paradas.length) throw new HttpError(400, 'La ruta no tiene paradas');
  return calcular({ origen: env.deposito, destino: env.deposito, paradas, modo, optimizar });
}
