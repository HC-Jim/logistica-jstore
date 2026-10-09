import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MAX_PARADAS = 25; // límite de puntos intermedios de Routes API

const punto = ({ lat, lng }) => ({ location: { latLng: { latitude: lat, longitude: lng } } });
const segundos = (d) => (d ? parseInt(d, 10) : 0); // "123s" → 123

/**
 * Camino que le queda al conductor: desde su posición, por las paradas pendientes (en orden),
 * hasta el almacén. Devuelve el total y cada tramo (legs[0] = hasta la próxima parada).
 * Con `optimizar` Google reordena las paradas y `orden` trae los índices de `paradas`.
 */
export async function trazarRestante(origen, paradas, { optimizar = false } = {}) {
  if (!env.googleMapsServerKey) {
    throw new HttpError(400, 'Configura GOOGLE_MAPS_SERVER_KEY (Routes API) en el backend para trazar rutas');
  }
  if (paradas.length > MAX_PARADAS) {
    throw new HttpError(400, `Google permite máximo ${MAX_PARADAS} paradas por ruta (hay ${paradas.length})`);
  }
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.googleMapsServerKey,
      'X-Goog-FieldMask': [
        'routes.distanceMeters',
        'routes.duration',
        'routes.polyline.encodedPolyline',
        'routes.legs.distanceMeters',
        'routes.legs.duration',
        'routes.legs.polyline.encodedPolyline',
        'routes.optimizedIntermediateWaypointIndex',
      ].join(','),
    },
    body: JSON.stringify({
      origin: punto(origen),
      destination: punto(env.deposito),
      intermediates: paradas.map(punto),
      travelMode: 'DRIVE',
      optimizeWaypointOrder: optimizar && paradas.length > 1,
      languageCode: 'es',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Routes API:', data);
    throw new HttpError(502, `Google Routes API: ${data.error?.message ?? res.statusText}`);
  }
  const ruta = data.routes?.[0];
  if (!ruta) throw new HttpError(422, 'Google no encontró un camino para las paradas pendientes');
  const optimizado = ruta.optimizedIntermediateWaypointIndex;
  return {
    orden: optimizado?.length && optimizado[0] !== -1 ? optimizado : paradas.map((_, i) => i),
    distanciaMetros: ruta.distanceMeters ?? 0,
    duracionSegundos: segundos(ruta.duration),
    polyline: ruta.polyline?.encodedPolyline ?? null,
    legs: (ruta.legs ?? []).map((l) => ({
      distanciaMetros: l.distanceMeters ?? 0,
      duracionSegundos: segundos(l.duration),
      polyline: l.polyline?.encodedPolyline ?? null,
    })),
  };
}

/**
 * Traza la ruta depósito → paradas → depósito con Google Routes API.
 * Con `optimizar` Google reordena las paradas para minimizar el recorrido.
 * Devuelve el orden (índices de `paradas`), distancia, duración y polilínea.
 */
export async function trazarRuta(paradas, { optimizar = false } = {}) {
  if (!env.googleMapsServerKey) {
    throw new HttpError(400, 'Configura GOOGLE_MAPS_SERVER_KEY (Routes API) en el backend para trazar rutas');
  }
  if (!paradas.length) throw new HttpError(400, 'La ruta no tiene paradas');
  if (paradas.length > MAX_PARADAS) {
    throw new HttpError(400, `Google permite máximo ${MAX_PARADAS} paradas por ruta (hay ${paradas.length})`);
  }

  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.googleMapsServerKey,
      'X-Goog-FieldMask': [
        'routes.distanceMeters',
        'routes.duration',
        'routes.polyline.encodedPolyline',
        'routes.optimizedIntermediateWaypointIndex',
      ].join(','),
    },
    body: JSON.stringify({
      origin: punto(env.deposito),
      destination: punto(env.deposito),
      intermediates: paradas.map(punto),
      travelMode: 'DRIVE',
      optimizeWaypointOrder: optimizar && paradas.length > 1,
      languageCode: 'es',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Routes API:', data);
    throw new HttpError(502, `Google Routes API: ${data.error?.message ?? res.statusText}`);
  }
  const ruta = data.routes?.[0];
  if (!ruta) throw new HttpError(422, 'Google no encontró una ruta para estas paradas');

  const optimizado = ruta.optimizedIntermediateWaypointIndex;
  return {
    orden: optimizado?.length && optimizado[0] !== -1 ? optimizado : paradas.map((_, i) => i),
    distanciaMetros: ruta.distanceMeters ?? 0,
    duracionSegundos: segundos(ruta.duration),
    polyline: ruta.polyline?.encodedPolyline ?? null,
  };
}
