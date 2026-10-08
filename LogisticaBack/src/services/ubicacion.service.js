import { HttpError } from '../utils/http.js';

// Solo se siguen enlaces de Google Maps (evita que el servidor visite URLs arbitrarias).
const HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i;

const PATRONES = [
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // punto exacto del lugar
  /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
  /@(-?\d+\.\d+),(-?\d+\.\d+)/, // centro de la vista
];

/** Extrae { lat, lng } de una URL de Google Maps, o null. */
export function coordenadasDeUrl(url) {
  const texto = decodeURIComponent(url);
  for (const patron of PATRONES) {
    const m = texto.match(patron);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

/** Sigue las redirecciones de un enlace corto (maps.app.goo.gl) hasta obtener las coordenadas. */
export async function resolverLink(enlace) {
  let url;
  try {
    url = new URL(String(enlace).trim());
  } catch {
    throw new HttpError(400, 'El enlace no es una URL válida');
  }
  for (let saltos = 0; saltos < 6; saltos++) {
    if (!HOSTS.test(url.hostname)) throw new HttpError(400, 'Solo se aceptan enlaces de Google Maps');
    const directa = coordenadasDeUrl(url.href);
    if (directa) return { ...directa, url: url.href };
    // Página de consentimiento: el destino real va en ?continue=
    const continuar = url.searchParams.get('continue');
    if (continuar) { url = new URL(continuar); continue; }

    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const destino = res.headers.get('location');
    if (!destino) break;
    url = new URL(destino, url);
  }
  throw new HttpError(422, 'No se encontraron coordenadas en el enlace; marca el punto en el mapa');
}
