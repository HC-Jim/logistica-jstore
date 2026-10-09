'use client';

import { AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect, useState } from 'react';
import { mensajeError } from '../api/client';
import { catalogosApi } from '../api/services';
import { hayMapsKey, LIMA, Mapa, SinMapsKey } from './maps';

// Lima Metropolitana y Callao: el mapa abre aquí y la búsqueda de direcciones da prioridad a esta zona
const ZONA_LIMA = { south: -12.55, west: -77.25, north: -11.70, east: -76.70 };

/** Rango aproximado de Perú, para detectar coordenadas invertidas o de otro país. */
const enPeru = (lat, lng) => lat >= -18.5 && lat <= 0.1 && lng >= -81.5 && lng <= -68.5;

/**
 * Lee coordenadas escritas a mano:
 * - decimales: "-12.046374, -77.042793" (lo que copia Google Maps con clic derecho)
 * - grados: 12°02'47.0"S 77°02'34.1"W
 * Devuelve { lat, lng } o null si el texto no son coordenadas.
 */
export function leerCoordenadas(texto) {
  const t = (texto ?? '').trim();
  let lat, lng;
  const dec = t.match(/^\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/);
  if (dec) {
    [lat, lng] = [Number(dec[1]), Number(dec[2])];
  } else {
    const gms = [...t.matchAll(/(\d{1,3})\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*["″]\s*)?([NSEOW])/gi)];
    if (gms.length !== 2) return null;
    const valor = ([, g, m = 0, s = 0, h]) => {
      const v = Number(g) + Number(String(m).replace(',', '.')) / 60 + Number(String(s).replace(',', '.')) / 3600;
      return /[SWO]/i.test(h) ? -v : v;
    };
    const [a, b] = gms;
    [lat, lng] = /[NS]/i.test(a[4]) ? [valor(a), valor(b)] : [valor(b), valor(a)];
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!enPeru(lat, lng) && enPeru(lng, lat)) [lat, lng] = [lng, lat]; // las pegaron al revés
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const redondear = ({ lat, lng }) => ({ lat: +Number(lat).toFixed(7), lng: +Number(lng).toFixed(7) });

/**
 * Ubicación exacta de entrega. Se puede:
 * - pegar el link de Google Maps que envía el cliente (incluye maps.app.goo.gl),
 * - buscar la dirección escrita,
 * - hacer clic en el mapa o arrastrar el marcador.
 */
export default function MapaSelector({ valor, onChange, direccion, link, onLink, disabled, sinBuscar, ayuda }) {
  const punto = valor?.lat != null && valor?.lng != null ? { lat: valor.lat, lng: valor.lng } : null;
  const [estado, setEstado] = useState('');

  async function usarLink() {
    if (!link) return;
    const coords = leerCoordenadas(link);
    if (coords) {
      onChange(redondear(coords));
      setEstado(enPeru(coords.lat, coords.lng)
        ? 'Ubicación tomada de las coordenadas ✔'
        : '⚠ Esas coordenadas están fuera de Perú; revisa el punto en el mapa.');
      return;
    }
    setEstado('Leyendo enlace…');
    try {
      const r = await catalogosApi.resolverUbicacion(link);
      onChange(redondear(r));
      setEstado('Ubicación tomada del enlace ✔');
    } catch (err) {
      setEstado(mensajeError(err));
    }
  }

  return (
    <div className="mapa-selector">
      <div className="fila">
        <input className="crece" placeholder="Link de Google Maps / WhatsApp o coordenadas (-12.0464, -77.0428)" value={link ?? ''}
          disabled={disabled} onChange={(e) => onLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); usarLink(); } }} />
        <button type="button" className="btn-sec" onClick={usarLink} disabled={disabled || !link}>Ubicar</button>
        {hayMapsKey && !sinBuscar && <BuscarDireccion direccion={direccion} disabled={disabled} onEncontrado={(p) => { onChange(p); setEstado('Ubicación tomada de la dirección; verifica el punto ✔'); }} onError={setEstado} />}
        {punto && !disabled && (
          <button type="button" className="btn-link-oscuro" onClick={() => { onChange({ lat: null, lng: null }); setEstado(''); }}>
            Quitar punto
          </button>
        )}
      </div>
      {estado && <small className="ayuda">{estado}</small>}

      {hayMapsKey ? (
        <Mapa alto={340} defaultCenter={punto ?? LIMA} defaultZoom={punto ? 16 : 11}
          onClick={(e) => !disabled && e.detail.latLng && onChange(redondear(e.detail.latLng))}>
          {punto && (
            <AdvancedMarker position={punto} draggable={!disabled}
              onDragEnd={(e) => onChange(redondear({ lat: e.latLng.lat(), lng: e.latLng.lng() }))} />
          )}
          <Centrar punto={punto} />
        </Mapa>
      ) : (
        <SinMapsKey />
      )}
      {ayuda && <small className="ayuda">{ayuda}</small>}
      <small className="ayuda">
        {punto ? `Punto: ${punto.lat}, ${punto.lng}${disabled ? '' : ' — arrastra el marcador para ajustar'}` : 'Sin ubicación: el pedido no se podrá agregar a una ruta.'}
      </small>
    </div>
  );
}

/** Centra el mapa cuando el punto cambia desde fuera (link o búsqueda). */
function Centrar({ punto }) {
  const map = useMap();
  const clave = punto ? `${punto.lat},${punto.lng}` : '';
  useEffect(() => {
    if (!map || !punto) return;
    if (!map.getBounds()?.contains(punto)) {
      map.setCenter(punto);
      map.setZoom(16);
    }
  }, [map, clave]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function BuscarDireccion({ direccion, onEncontrado, onError, disabled }) {
  const geocoding = useMapsLibrary('geocoding');
  async function buscar() {
    try {
      const { results } = await new geocoding.Geocoder().geocode({
        address: direccion, region: 'pe', bounds: ZONA_LIMA, componentRestrictions: { country: 'PE' },
      });
      const loc = results[0].geometry.location;
      onEncontrado(redondear({ lat: loc.lat(), lng: loc.lng() }));
    } catch {
      onError('No se encontró la dirección; marca el punto en el mapa.');
    }
  }
  return (
    <button type="button" className="btn-sec" onClick={buscar} disabled={disabled || !direccion || !geocoding}>
      Buscar dirección
    </button>
  );
}
